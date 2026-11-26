import { AuthError, toAuthError } from './errors';
import { getNative } from './native';
import {
  appendParams,
  getScheme,
  isSecureEndpoint,
  matchesRedirectUri,
  parseRedirectParams,
  type Params,
} from './url';

export interface AuthorizeRequest {
  authorizationEndpoint: string;
  clientId: string;
  /** Custom scheme (`myapp://callback`) or https Universal/App Link. */
  redirectUri: string;
  /**
   * URL the browser finally lands on, when it is not `redirectUri` itself.
   * For providers that only accept https redirects: `redirectUri` is a page
   * on your backend that forwards the query string to this app URL.
   */
  callbackUri?: string;
  /** Provider `error` values that mean the user backed out. `access_denied` always does. */
  cancelErrors?: string[];
  scopes?: string[];
  /** Defaults to a space, as in RFC 6749. Some providers use a comma. */
  scopeSeparator?: string;
  /** Defaults to true. Only disable for providers that reject PKCE. */
  usePKCE?: boolean;
  /** Sends an OpenID Connect `nonce`. Enable when requesting an `id_token`. */
  useNonce?: boolean;
  /** Extra authorization parameters (`prompt`, `login_hint`, …). */
  extraParams?: Record<string, string>;
  /** Name of the client id parameter. Defaults to `client_id`. */
  clientIdParam?: string;
  /** iOS: do not share cookies with Safari. Android: ephemeral Custom Tab when supported. */
  prefersEphemeralSession?: boolean;
}

export interface AuthorizeResult {
  /** Authorization code to exchange at the token endpoint. */
  code: string;
  /** PKCE verifier to send along with the code. Undefined when PKCE is off. */
  codeVerifier?: string;
  state: string;
  /** Nonce the `id_token` must carry. Undefined unless `useNonce` is set. */
  nonce?: string;
  redirectUri: string;
  /** Every parameter the provider sent back in the redirect. */
  params: Params;
}

let inProgress = false;

function assertConfig(request: AuthorizeRequest): void {
  const missing = (
    ['authorizationEndpoint', 'clientId', 'redirectUri'] as const
  ).filter((key) => !request[key]);
  if (missing.length > 0) {
    throw new AuthError(
      'INVALID_CONFIG',
      `Missing required option(s): ${missing.join(', ')}`
    );
  }
  if (!isSecureEndpoint(request.authorizationEndpoint)) {
    throw new AuthError(
      'INVALID_CONFIG',
      'authorizationEndpoint must be an https URL'
    );
  }
  if (!getScheme(request.redirectUri)) {
    throw new AuthError(
      'INVALID_CONFIG',
      'redirectUri must be an absolute URI, e.g. myapp://callback'
    );
  }
  if (request.callbackUri !== undefined && !getScheme(request.callbackUri)) {
    throw new AuthError(
      'INVALID_CONFIG',
      'callbackUri must be an absolute URI, e.g. myapp://callback'
    );
  }
}

/**
 * Runs the OAuth 2.0 authorization code flow in the system browser and
 * returns the code. `state` is generated and verified here; nothing is stored.
 */
export async function authorize(
  request: AuthorizeRequest
): Promise<AuthorizeResult> {
  assertConfig(request);
  const native = getNative();
  if (inProgress) {
    throw new AuthError(
      'INVALID_CONFIG',
      'Another sign-in is already in progress'
    );
  }

  // Claimed before the first await so two taps cannot start two sign-ins.
  inProgress = true;
  let redirect: string;
  let state: string;
  let nonce: string | undefined;
  let codeVerifier: string | undefined;
  const callbackUri = request.callbackUri ?? request.redirectUri;
  try {
    state = await native.randomBase64Url(16);
    nonce = request.useNonce ? await native.randomBase64Url(16) : undefined;
    codeVerifier =
      request.usePKCE === false ? undefined : await native.randomBase64Url(32);
    const codeChallenge = codeVerifier
      ? await native.sha256Base64Url(codeVerifier)
      : undefined;

    const url = appendParams(request.authorizationEndpoint, {
      ...request.extraParams,
      response_type: 'code',
      [request.clientIdParam ?? 'client_id']: request.clientId,
      redirect_uri: request.redirectUri,
      scope:
        request.scopes && request.scopes.length > 0
          ? request.scopes.join(request.scopeSeparator ?? ' ')
          : undefined,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: codeVerifier ? 'S256' : undefined,
    });

    redirect = await native.openAuthSession(
      url,
      callbackUri,
      request.prefersEphemeralSession ?? false
    );
  } catch (error) {
    throw toAuthError(error);
  } finally {
    inProgress = false;
  }

  if (!matchesRedirectUri(redirect, callbackUri)) {
    throw new AuthError(
      'PROVIDER_ERROR',
      'The browser returned to an unexpected redirect URI'
    );
  }

  const params = parseRedirectParams(redirect);
  // Reported before the state check: some providers omit `state` on errors,
  // and an error grants nothing.
  if (params.error) {
    throw new AuthError(
      params.error === 'access_denied' ||
        request.cancelErrors?.includes(params.error)
        ? 'CANCELLED'
        : 'PROVIDER_ERROR',
      params.error_description || `The provider returned "${params.error}"`,
      {
        providerError: params.error,
        providerErrorDescription: params.error_description,
      }
    );
  }
  // A code is only accepted with the state we generated: anything else did
  // not come from the request we started.
  if (params.state !== state) {
    throw new AuthError(
      'PROVIDER_ERROR',
      'State mismatch: the response does not belong to this sign-in'
    );
  }
  if (!params.code) {
    throw new AuthError(
      'PROVIDER_ERROR',
      'The provider did not return an authorization code'
    );
  }

  return {
    code: params.code,
    codeVerifier,
    state,
    nonce,
    redirectUri: request.redirectUri,
    params,
  };
}

/** Dismisses the browser of the sign-in in progress; it rejects with CANCELLED. */
export async function cancelAuthorize(): Promise<void> {
  await getNative().cancelAuthSession();
}
