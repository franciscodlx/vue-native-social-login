import { authorize, type AuthorizeResult } from './authorize';
import { AuthError } from './errors';
import {
  decodeIdToken,
  validateIdTokenClaims,
  type IdTokenClaims,
} from './idToken';
import { isAvailable } from './native';
import {
  exchangeCode,
  fetchUserInfo,
  revokeToken,
  type TokenResponse,
} from './token';

/** What a provider package contributes on top of the core. */
export interface ProviderConfig<TProfile = Record<string, unknown>> {
  /** Short id used in error messages, e.g. `linkedin`. */
  id: string;
  authorizationEndpoint: string;
  /** Needed for `exchangeCode: true` (public clients only). */
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  revocationEndpoint?: string;
  /** Expected `iss` of the id_token, for OpenID Connect providers. */
  issuer?: string;
  defaultScopes: string[];
  scopeSeparator?: string;
  /** Defaults to true. */
  usePKCE?: boolean;
  /** Send and verify an OpenID Connect nonce. Defaults to false. */
  useNonce?: boolean;
  clientIdParam?: string;
  /** Provider `error` values that mean the user backed out (besides `access_denied`). */
  cancelErrors?: string[];
  extraAuthParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
  /** Maps the userinfo response (or the id_token claims) to a typed profile. */
  mapProfile?: (raw: Record<string, unknown>) => TProfile;
}

export interface SignInOptions {
  clientId: string;
  redirectUri: string;
  /** App URL the browser lands on when `redirectUri` is a forwarding page on your backend. */
  callbackUri?: string;
  /** Overrides the provider's default scopes. */
  scopes?: string[];
  extraParams?: Record<string, string>;
  prefersEphemeralSession?: boolean;
  /**
   * Exchange the code on-device as a public client (PKCE, no secret) and
   * load the profile. Leave false when your backend does the exchange.
   */
  exchangeCode?: boolean;
}

export interface SignInResult<
  TProfile = Record<string, unknown>,
> extends AuthorizeResult {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  /** Lifetime of the access token in seconds. */
  expiresIn?: number;
  scope?: string;
  /** Unverified id_token claims (signature is checked on your backend). */
  idTokenClaims?: IdTokenClaims;
  profile?: TProfile;
  tokenResponse?: TokenResponse;
}

export interface SignOutOptions {
  clientId?: string;
  /** Token to revoke at the provider, when it has a revocation endpoint. */
  token?: string;
  tokenTypeHint?: 'access_token' | 'refresh_token';
}

/** The API every plugin of the family exposes. */
export interface ProviderLogin<TProfile = Record<string, unknown>> {
  readonly provider: ProviderConfig<TProfile>;
  signIn(options: SignInOptions): Promise<SignInResult<TProfile>>;
  signOut(options?: SignOutOptions): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export function createProviderLogin<TProfile = Record<string, unknown>>(
  provider: ProviderConfig<TProfile>
): ProviderLogin<TProfile> {
  const mapProfile = (raw: Record<string, unknown>): TProfile =>
    provider.mapProfile ? provider.mapProfile(raw) : (raw as TProfile);

  async function signIn(
    options: SignInOptions
  ): Promise<SignInResult<TProfile>> {
    const tokenEndpoint = provider.tokenEndpoint;
    if (options.exchangeCode && !tokenEndpoint) {
      throw new AuthError(
        'INVALID_CONFIG',
        `${provider.id} cannot exchange the code on-device; do it from your backend`
      );
    }

    const authorization = await authorize({
      authorizationEndpoint: provider.authorizationEndpoint,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      callbackUri: options.callbackUri,
      cancelErrors: provider.cancelErrors,
      scopes: options.scopes ?? provider.defaultScopes,
      scopeSeparator: provider.scopeSeparator,
      usePKCE: provider.usePKCE,
      useNonce: provider.useNonce,
      clientIdParam: provider.clientIdParam,
      extraParams: { ...provider.extraAuthParams, ...options.extraParams },
      prefersEphemeralSession: options.prefersEphemeralSession,
    });

    if (!options.exchangeCode || !tokenEndpoint) {
      return authorization;
    }

    const tokens = await exchangeCode({
      tokenEndpoint,
      clientId: options.clientId,
      code: authorization.code,
      redirectUri: authorization.redirectUri,
      codeVerifier: authorization.codeVerifier,
      clientIdParam: provider.clientIdParam,
      extraParams: provider.extraTokenParams,
    });

    let idTokenClaims: IdTokenClaims | undefined;
    if (tokens.idToken) {
      idTokenClaims = decodeIdToken(tokens.idToken);
      validateIdTokenClaims(idTokenClaims, {
        issuer: provider.issuer,
        audience: options.clientId,
        nonce: authorization.nonce,
      });
    }

    let profile: TProfile | undefined;
    if (provider.userInfoEndpoint && tokens.accessToken) {
      profile = mapProfile(
        await fetchUserInfo(provider.userInfoEndpoint, tokens.accessToken)
      );
    } else if (idTokenClaims) {
      profile = mapProfile(idTokenClaims);
    }

    return {
      ...authorization,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
      idTokenClaims,
      profile,
      tokenResponse: tokens,
    };
  }

  // The core keeps no session, so signing out only means revoking the token
  // at the provider when that is possible. Clearing your own stored tokens is
  // up to the app.
  async function signOut(options: SignOutOptions = {}): Promise<void> {
    if (provider.revocationEndpoint && options.token && options.clientId) {
      await revokeToken({
        revocationEndpoint: provider.revocationEndpoint,
        clientId: options.clientId,
        token: options.token,
        tokenTypeHint: options.tokenTypeHint,
      });
    }
  }

  return { provider, signIn, signOut, isAvailable };
}
