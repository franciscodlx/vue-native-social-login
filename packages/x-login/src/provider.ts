import {
  createProviderLogin,
  refreshAccessToken,
  type ProviderConfig,
  type ProviderLogin,
  type SignInOptions,
  type TokenResponse,
} from '@franciscodlxdev/vue-native-auth-core';

export const X_AUTHORIZATION_ENDPOINT = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token';
export const X_REVOCATION_ENDPOINT = 'https://api.x.com/2/oauth2/revoke';
export const X_USERINFO_ENDPOINT = 'https://api.x.com/2/users/me';

/** What `GET /2/users/me` needs. Add `offline.access` for a refresh token. */
export const X_DEFAULT_SCOPES = ['users.read', 'tweet.read'];
/** Scope that makes X issue a refresh token. */
export const X_OFFLINE_SCOPE = 'offline.access';
/** Scope that lets the app read the account's confirmed email. */
export const X_EMAIL_SCOPE = 'users.email';

const BASE_USER_FIELDS = [
  'id',
  'name',
  'username',
  'profile_image_url',
  'verified',
];

export interface XProfile {
  /** Numeric user id, as a string. */
  id: string;
  /** Handle without the `@`. */
  username: string;
  name?: string;
  /** Avatar URL (X returns the 48px `_normal` variant). */
  picture?: string;
  verified?: boolean;
  /** Only with the `users.email` scope, and only if the account has one. */
  email?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Maps the `GET /2/users/me` response (`{ data: {...} }`) to a profile. */
export function mapXProfile(raw: Record<string, unknown>): XProfile {
  const data =
    raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : raw;
  return {
    id: String(data.id ?? ''),
    username: String(data.username ?? ''),
    name: text(data.name),
    picture: text(data.profile_image_url),
    verified: typeof data.verified === 'boolean' ? data.verified : undefined,
    email: text(data.confirmed_email),
  };
}

/** `/2/users/me` URL asking for the fields the granted scopes allow. */
export function xUserInfoUrl(
  endpoint: string = X_USERINFO_ENDPOINT,
  scopes: string[] = X_DEFAULT_SCOPES
): string {
  const fields = scopes.includes(X_EMAIL_SCOPE)
    ? [...BASE_USER_FIELDS, 'confirmed_email']
    : BASE_USER_FIELDS;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}user.fields=${fields.join(',')}`;
}

export const xProvider: ProviderConfig<XProfile> = {
  id: 'x',
  authorizationEndpoint: X_AUTHORIZATION_ENDPOINT,
  tokenEndpoint: X_TOKEN_ENDPOINT,
  userInfoEndpoint: X_USERINFO_ENDPOINT,
  revocationEndpoint: X_REVOCATION_ENDPOINT,
  defaultScopes: X_DEFAULT_SCOPES,
  // PKCE (S256) is on by default in the core; X is not OpenID Connect, so
  // there is no id_token and no nonce.
  mapProfile: mapXProfile,
};

export interface XRefreshOptions {
  clientId: string;
  refreshToken: string;
}

export interface XLogin extends ProviderLogin<XProfile> {
  /**
   * Trades a refresh token for a new access token (needs the
   * `offline.access` scope at sign-in). Store the refresh token that comes
   * back: assume the old one stops working.
   */
  refresh(options: XRefreshOptions): Promise<TokenResponse>;
}

/**
 * Builds an X login. Pass overrides to point it at a test server or to add
 * authorization parameters.
 */
export function createXLogin(
  overrides: Partial<ProviderConfig<XProfile>> = {}
): XLogin {
  const config = { ...xProvider, ...overrides };
  const base = createProviderLogin(config);

  return {
    ...base,
    // The user fields X will return depend on the scopes of this sign-in.
    signIn(options: SignInOptions) {
      if (!config.userInfoEndpoint) {
        return base.signIn(options);
      }
      return createProviderLogin({
        ...config,
        userInfoEndpoint: xUserInfoUrl(
          config.userInfoEndpoint,
          options.scopes ?? config.defaultScopes
        ),
      }).signIn(options);
    },
    refresh({ clientId, refreshToken }: XRefreshOptions) {
      return refreshAccessToken({
        tokenEndpoint: config.tokenEndpoint ?? X_TOKEN_ENDPOINT,
        clientId,
        refreshToken,
      });
    },
  };
}

export const xLogin = createXLogin();
