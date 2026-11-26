import { AuthError } from './errors';
import { encodeParams } from './url';

export interface TokenResponse {
  accessToken?: string;
  tokenType?: string;
  /** Lifetime of the access token in seconds. */
  expiresIn?: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  /** Response body exactly as the provider sent it. */
  raw: Record<string, unknown>;
}

export interface ExchangeCodeRequest {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  /** Extra form fields required by the provider. */
  extraParams?: Record<string, string>;
  /** Name of the client id field. Defaults to `client_id`. */
  clientIdParam?: string;
  headers?: Record<string, string>;
}

export interface RefreshTokenRequest {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  scopes?: string[];
  extraParams?: Record<string, string>;
  clientIdParam?: string;
  headers?: Record<string, string>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : undefined;
}

/** How long a token, userinfo or revoke request may take before it fails with `NETWORK`. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Fetches `url` and reads its body, giving up after {@link REQUEST_TIMEOUT_MS}. */
async function fetchText(
  url: string,
  init: RequestInit
): Promise<[Response, string]> {
  // Aborting frees the connection where AbortController exists; the timer
  // alone already settles the promise everywhere else.
  const controller =
    typeof AbortController === 'function' && !init.signal
      ? new AbortController()
      : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(
        new AuthError(
          'NETWORK',
          `${url} did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`
        )
      );
    }, REQUEST_TIMEOUT_MS);
  });
  const request = (async (): Promise<[Response, string]> => {
    const response = await fetch(
      url,
      controller ? { ...init, signal: controller.signal } : init
    );
    return [response, await response.text().catch(() => '')];
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson(
  url: string,
  init: RequestInit
): Promise<Record<string, unknown>> {
  let response: Response;
  let text: string;
  try {
    [response, text] = await fetchText(url, init);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('NETWORK', `Could not reach ${url}`, { cause: error });
  }

  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON body: reported through the status below.
    }
  }

  if (!response.ok || typeof body.error === 'string') {
    // OAuth errors use `error`/`error_description`; REST APIs such as X's
    // return problem details (`title`, `detail`, `reason`) instead.
    const providerError = asString(body.error) ?? asString(body.reason);
    const description =
      asString(body.error_description) ??
      asString(body.message) ??
      asString(body.detail) ??
      asString(body.title);
    throw new AuthError(
      'PROVIDER_ERROR',
      description ??
        (providerError
          ? `The provider returned "${providerError}"`
          : `Request failed with status ${response.status}`),
      {
        providerError,
        providerErrorDescription: description,
        status: response.status,
      }
    );
  }
  return body;
}

function toTokenResponse(raw: Record<string, unknown>): TokenResponse {
  return {
    accessToken: asString(raw.access_token),
    tokenType: asString(raw.token_type),
    expiresIn: asNumber(raw.expires_in),
    refreshToken: asString(raw.refresh_token),
    idToken: asString(raw.id_token),
    scope: asString(raw.scope),
    raw,
  };
}

function postForm(
  url: string,
  form: Record<string, string | undefined>,
  headers?: Record<string, string>
): Promise<Record<string, unknown>> {
  return requestJson(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: encodeParams(form),
  });
}

/**
 * Exchanges the code as a **public client** (PKCE, no client secret).
 * If the provider requires a secret, do this from your backend instead.
 */
export async function exchangeCode(
  request: ExchangeCodeRequest
): Promise<TokenResponse> {
  const raw = await postForm(
    request.tokenEndpoint,
    {
      ...request.extraParams,
      grant_type: 'authorization_code',
      code: request.code,
      redirect_uri: request.redirectUri,
      [request.clientIdParam ?? 'client_id']: request.clientId,
      code_verifier: request.codeVerifier,
    },
    request.headers
  );
  return toTokenResponse(raw);
}

/** Refreshes an access token as a public client. */
export async function refreshAccessToken(
  request: RefreshTokenRequest
): Promise<TokenResponse> {
  const raw = await postForm(
    request.tokenEndpoint,
    {
      ...request.extraParams,
      grant_type: 'refresh_token',
      refresh_token: request.refreshToken,
      [request.clientIdParam ?? 'client_id']: request.clientId,
      scope:
        request.scopes && request.scopes.length > 0
          ? request.scopes.join(' ')
          : undefined,
    },
    request.headers
  );
  return toTokenResponse(raw);
}

/** Revokes a token (RFC 7009) as a public client. */
export async function revokeToken(request: {
  revocationEndpoint: string;
  clientId: string;
  token: string;
  tokenTypeHint?: 'access_token' | 'refresh_token';
}): Promise<void> {
  await postForm(request.revocationEndpoint, {
    token: request.token,
    token_type_hint: request.tokenTypeHint,
    client_id: request.clientId,
  });
}

/** GETs a userinfo-style endpoint with a bearer token. */
export function fetchUserInfo(
  userInfoEndpoint: string,
  accessToken: string,
  headers?: Record<string, string>
): Promise<Record<string, unknown>> {
  return requestJson(userInfoEndpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
  });
}
