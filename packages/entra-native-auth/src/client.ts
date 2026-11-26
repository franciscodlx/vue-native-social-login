import {
  AuthError,
  createProviderLogin,
  decodeIdToken,
  encodeParams,
  validateIdTokenClaims,
  type IdTokenClaims,
  type SignInResult,
} from '@franciscodlxdev/vue-native-auth-core';
import {
  EntraAuthError,
  type EntraErrorBody,
  type RequiredAttribute,
} from './errors';

export interface EntraNativeAuthConfig {
  /** `contoso` for the external tenant `contoso.onmicrosoft.com`. */
  tenantSubdomain: string;
  /** Application (client) ID of the app registration. */
  clientId: string;
  /** Defaults to `openid offline_access` (id_token + refresh token). */
  scopes?: string[];
  /**
   * Replaces `https://{tenant}.ciamlogin.com/{tenant}.onmicrosoft.com`,
   * e.g. to point at a test server.
   */
  baseUrl?: string;
  /** How long `submitNewPassword` waits for the reset to complete. Defaults to 30 s. */
  pollTimeoutMs?: number;
}

export type EntraFlow = 'signIn' | 'signUp' | 'resetPassword';

export interface EntraProfile {
  /** `oid` (or `sub`) of the id_token. */
  id: string;
  email?: string;
  name?: string;
}

export interface EntraTokens {
  accessToken: string;
  /** Only with the `openid` scope. */
  idToken?: string;
  /** Only with the `offline_access` scope. */
  refreshToken?: string;
  /** Lifetime of the access token in seconds. */
  expiresIn?: number;
  scope?: string;
  /** Unverified id_token claims (verify the signature on your backend). */
  idTokenClaims?: IdTokenClaims;
  profile?: EntraProfile;
}

interface StepBase {
  flow: EntraFlow;
  username: string;
  /** Opaque; pass the whole step back to the next method. */
  continuationToken: string;
}

/** A one-time passcode was sent; ask for it and call `submitCode`. */
export interface CodeRequiredStep extends StepBase {
  type: 'code_required';
  /** `email` or `sms`. */
  channel?: string;
  /** Masked destination, e.g. `c***r@co**o.com`. */
  sentTo?: string;
  codeLength?: number;
}

/** Ask for the password and call `submitPassword`. */
export interface PasswordRequiredStep extends StepBase {
  type: 'password_required';
}

/** The user flow needs more attributes; call `submitAttributes`. */
export interface AttributesRequiredStep extends StepBase {
  type: 'attributes_required';
  requiredAttributes: RequiredAttribute[];
}

/** The code was accepted; ask for the new password and call `submitNewPassword`. */
export interface NewPasswordRequiredStep extends StepBase {
  type: 'new_password_required';
}

/**
 * Entra cannot finish this flow through the API (for example MFA or a sign-in
 * method the app did not declare). Continue with `signInWithBrowser`.
 */
export interface BrowserRequiredStep {
  type: 'browser_required';
  flow: EntraFlow;
  username: string;
}

export interface SignedInStep {
  type: 'signed_in';
  tokens: EntraTokens;
}

export type EntraStep =
  | CodeRequiredStep
  | PasswordRequiredStep
  | AttributesRequiredStep
  | NewPasswordRequiredStep
  | BrowserRequiredStep
  | SignedInStep;

export interface BrowserSignInOptions {
  /** A redirect URI registered for the app, e.g. `miapp://callback`. */
  redirectUri: string;
  /** Pre-fills the account, e.g. `step.username`. */
  loginHint?: string;
  prefersEphemeralSession?: boolean;
}

export interface EntraNativeAuth {
  /** Email + password when `password` is given, email one-time passcode otherwise. */
  signIn(input: { username: string; password?: string }): Promise<EntraStep>;
  signUp(input: {
    username: string;
    /** Omit for tenants that use email one-time passcode. */
    password?: string;
    /** Keyed by the attribute's programmable name, e.g. `{ displayName, city }`. */
    attributes?: Record<string, string>;
  }): Promise<EntraStep>;
  /** Self-service password reset (email + password accounts). */
  resetPassword(input: { username: string }): Promise<EntraStep>;
  submitCode(step: CodeRequiredStep, code: string): Promise<EntraStep>;
  /** Sends a new code for the same step. */
  resendCode(step: CodeRequiredStep): Promise<EntraStep>;
  submitPassword(
    step: PasswordRequiredStep,
    password: string
  ): Promise<EntraStep>;
  submitAttributes(
    step: AttributesRequiredStep,
    attributes: Record<string, string>
  ): Promise<EntraStep>;
  /** Sets the new password, waits for the reset and signs the user in. */
  submitNewPassword(
    step: NewPasswordRequiredStep,
    newPassword: string
  ): Promise<EntraStep>;
  refresh(refreshToken: string): Promise<EntraTokens>;
  /** Web fallback: the standard browser flow (authorization code + PKCE). */
  signInWithBrowser(options: BrowserSignInOptions): Promise<EntraTokens>;
}

type Body = Record<string, unknown>;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const START_PATH: Record<EntraFlow, string> = {
  signIn: '/oauth2/v2.0/initiate',
  signUp: '/signup/v1.0/start',
  resetPassword: '/resetpassword/v1.0/start',
};
const CHALLENGE_PATH: Record<EntraFlow, string> = {
  signIn: '/oauth2/v2.0/challenge',
  signUp: '/signup/v1.0/challenge',
  resetPassword: '/resetpassword/v1.0/challenge',
};

export function createEntraNativeAuth(
  config: EntraNativeAuthConfig
): EntraNativeAuth {
  if (!config.clientId || !(config.tenantSubdomain || config.baseUrl)) {
    throw new AuthError(
      'INVALID_CONFIG',
      'tenantSubdomain and clientId are required'
    );
  }
  const baseUrl = (
    config.baseUrl ??
    `https://${config.tenantSubdomain}.ciamlogin.com/${config.tenantSubdomain}.onmicrosoft.com`
  ).replace(/\/+$/, '');
  const scope = (config.scopes ?? ['openid', 'offline_access']).join(' ');
  const clientId = config.clientId;

  /** POSTs a form. Returns the JSON body; API errors come back as `{ error }` with `ok: false`. */
  async function post(
    path: string,
    form: Record<string, string | undefined>
  ): Promise<{ ok: boolean; status: number; body: Body }> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: encodeParams({ client_id: clientId, ...form }),
      });
    } catch (error) {
      throw new AuthError('NETWORK', 'Could not reach Microsoft Entra', {
        cause: error,
      });
    }
    let body: Body = {};
    try {
      const parsed: unknown = JSON.parse(await response.text());
      if (parsed && typeof parsed === 'object') {
        body = parsed as Body;
      }
    } catch {
      // Non-JSON body: reported through the status.
    }
    return { ok: response.ok && !body.error, status: response.status, body };
  }

  function fail(status: number, body: Body): never {
    const error = body as EntraErrorBody;
    throw new EntraAuthError(
      error.error === 'invalid_client' || error.error === 'unauthorized_client'
        ? 'INVALID_CONFIG'
        : 'PROVIDER_ERROR',
      error.error_description ??
        (error.error
          ? `Microsoft Entra returned "${error.error}"`
          : `Request failed with status ${status}`),
      error,
      status
    );
  }

  async function call(
    path: string,
    form: Record<string, string | undefined>
  ): Promise<Body> {
    const { ok, status, body } = await post(path, form);
    return ok ? body : fail(status, body);
  }

  const isRedirect = (body: Body) => body.challenge_type === 'redirect';
  const browser = (flow: EntraFlow, username: string): BrowserRequiredStep => ({
    type: 'browser_required',
    flow,
    username,
  });

  function token(body: Body): string {
    const value = text(body.continuation_token);
    if (!value) {
      throw new AuthError(
        'PROVIDER_ERROR',
        'Microsoft Entra did not return a continuation token'
      );
    }
    return value;
  }

  function toTokens(body: Body): EntraTokens {
    const accessToken = text(body.access_token);
    if (!accessToken) {
      throw new AuthError(
        'PROVIDER_ERROR',
        'Microsoft Entra did not return an access token'
      );
    }
    const idToken = text(body.id_token);
    let idTokenClaims: IdTokenClaims | undefined;
    let profile: EntraProfile | undefined;
    if (idToken) {
      idTokenClaims = decodeIdToken(idToken);
      validateIdTokenClaims(idTokenClaims, { audience: clientId });
      profile = {
        id: String(idTokenClaims.oid ?? idTokenClaims.sub ?? ''),
        email:
          text(idTokenClaims.email) ?? text(idTokenClaims.preferred_username),
        name: text(idTokenClaims.name),
      };
    }
    return {
      accessToken,
      idToken,
      refreshToken: text(body.refresh_token),
      expiresIn: number(body.expires_in),
      scope: text(body.scope),
      idTokenClaims,
      profile,
    };
  }

  async function requestToken(
    form: Record<string, string | undefined>
  ): Promise<SignedInStep> {
    return {
      type: 'signed_in',
      tokens: toTokens(await call('/oauth2/v2.0/token', { ...form, scope })),
    };
  }

  /** Asks Entra which credential comes next and turns the answer into a step. */
  async function challenge(
    flow: EntraFlow,
    username: string,
    continuationToken: string,
    challengeType: string
  ): Promise<CodeRequiredStep | PasswordRequiredStep | BrowserRequiredStep> {
    const body = await call(CHALLENGE_PATH[flow], {
      continuation_token: continuationToken,
      challenge_type: challengeType,
    });
    if (isRedirect(body)) {
      return browser(flow, username);
    }
    const base = { flow, username, continuationToken: token(body) };
    if (body.challenge_type === 'password') {
      return { type: 'password_required', ...base };
    }
    return {
      type: 'code_required',
      ...base,
      channel: text(body.challenge_channel),
      sentTo: text(body.challenge_target_label),
      codeLength: number(body.code_length),
    };
  }

  // Every request must offer `redirect`: it is how Entra says "use the browser".
  const challengeTypes = (withPassword: boolean) =>
    withPassword ? 'oob password redirect' : 'oob redirect';

  async function signInWithPassword(
    step: { username: string; continuationToken: string },
    password: string
  ): Promise<SignedInStep> {
    return requestToken({
      continuation_token: step.continuationToken,
      grant_type: 'password',
      password,
      username: step.username,
    });
  }

  /** After sign-up or password reset: the last continuation token becomes tokens. */
  const finish = (username: string, continuationToken: string) =>
    requestToken({
      continuation_token: continuationToken,
      grant_type: 'continuation_token',
      username,
    });

  /** `/signup/v1.0/continue`: Entra may still ask for a password or attributes. */
  async function continueSignUp(
    username: string,
    form: Record<string, string | undefined>
  ): Promise<EntraStep> {
    const { ok, status, body } = await post('/signup/v1.0/continue', form);
    if (ok) {
      return isRedirect(body)
        ? browser('signUp', username)
        : finish(username, token(body));
    }
    const base = {
      flow: 'signUp' as const,
      username,
      continuationToken: text(body.continuation_token) ?? '',
    };
    if (body.error === 'credential_required' && base.continuationToken) {
      // Entra says which credential through a new challenge.
      return challenge(
        'signUp',
        username,
        base.continuationToken,
        challengeTypes(true)
      );
    }
    if (body.error === 'attributes_required' && base.continuationToken) {
      return {
        type: 'attributes_required',
        ...base,
        requiredAttributes: Array.isArray(body.required_attributes)
          ? (body.required_attributes as RequiredAttribute[])
          : [],
      };
    }
    return fail(status, body);
  }

  return {
    async signIn({ username, password }) {
      const types = password ? 'password redirect' : 'oob redirect';
      const started = await call(START_PATH.signIn, {
        username,
        challenge_type: types,
      });
      if (isRedirect(started)) {
        return browser('signIn', username);
      }
      const step = await challenge('signIn', username, token(started), types);
      return step.type === 'password_required' && password
        ? signInWithPassword(step, password)
        : step;
    },

    async signUp({ username, password, attributes }) {
      const types = challengeTypes(Boolean(password));
      const started = await call(START_PATH.signUp, {
        username,
        password,
        attributes: attributes ? JSON.stringify(attributes) : undefined,
        challenge_type: types,
      });
      return isRedirect(started)
        ? browser('signUp', username)
        : challenge('signUp', username, token(started), types);
    },

    async resetPassword({ username }) {
      const started = await call(START_PATH.resetPassword, {
        username,
        challenge_type: 'oob redirect',
      });
      return isRedirect(started)
        ? browser('resetPassword', username)
        : challenge('resetPassword', username, token(started), 'oob redirect');
    },

    async submitCode(step, code) {
      const { username, continuationToken } = step;
      if (step.flow === 'signIn') {
        return requestToken({
          continuation_token: continuationToken,
          grant_type: 'oob',
          oob: code,
          username,
        });
      }
      if (step.flow === 'signUp') {
        return continueSignUp(username, {
          continuation_token: continuationToken,
          grant_type: 'oob',
          oob: code,
        });
      }
      const body = await call('/resetpassword/v1.0/continue', {
        continuation_token: continuationToken,
        grant_type: 'oob',
        oob: code,
      });
      return isRedirect(body)
        ? browser('resetPassword', username)
        : {
            type: 'new_password_required',
            flow: 'resetPassword',
            username,
            continuationToken: token(body),
          };
    },

    resendCode(step) {
      return challenge(
        step.flow,
        step.username,
        step.continuationToken,
        step.flow === 'signUp' ? challengeTypes(true) : 'oob redirect'
      );
    },

    submitPassword(step, password) {
      return step.flow === 'signUp'
        ? continueSignUp(step.username, {
            continuation_token: step.continuationToken,
            grant_type: 'password',
            password,
          })
        : signInWithPassword(step, password);
    },

    submitAttributes(step, attributes) {
      return continueSignUp(step.username, {
        continuation_token: step.continuationToken,
        grant_type: 'attributes',
        attributes: JSON.stringify(attributes),
      });
    },

    async submitNewPassword(step, newPassword) {
      const submitted = await call('/resetpassword/v1.0/submit', {
        continuation_token: step.continuationToken,
        new_password: newPassword,
      });
      let continuationToken = token(submitted);
      const interval = (number(submitted.poll_interval) ?? 2) * 1000;
      const deadline = Date.now() + (config.pollTimeoutMs ?? 30_000);
      for (;;) {
        const polled = await call('/resetpassword/v1.0/poll_completion', {
          continuation_token: continuationToken,
        });
        continuationToken =
          text(polled.continuation_token) ?? continuationToken;
        if (polled.status === 'succeeded') {
          return finish(step.username, continuationToken);
        }
        if (polled.status === 'failed') {
          throw new AuthError('PROVIDER_ERROR', 'The password reset failed');
        }
        if (Date.now() + interval > deadline) {
          throw new AuthError(
            'PROVIDER_ERROR',
            'The password reset is taking too long; ask the user to sign in with the new password'
          );
        }
        await sleep(interval);
      }
    },

    async refresh(refreshToken) {
      return toTokens(
        await call('/oauth2/v2.0/token', {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope,
        })
      );
    },

    async signInWithBrowser({
      redirectUri,
      loginHint,
      prefersEphemeralSession,
    }) {
      const result: SignInResult = await createProviderLogin({
        id: 'entra',
        authorizationEndpoint: `${baseUrl}/oauth2/v2.0/authorize`,
        tokenEndpoint: `${baseUrl}/oauth2/v2.0/token`,
        defaultScopes: scope.split(' '),
        useNonce: true,
      }).signIn({
        clientId,
        redirectUri,
        prefersEphemeralSession,
        extraParams: loginHint ? { login_hint: loginHint } : undefined,
        exchangeCode: true,
      });
      return toTokens(result.tokenResponse?.raw ?? {});
    },
  };
}
