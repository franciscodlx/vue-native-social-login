import {
  createProviderLogin,
  type ProviderConfig,
  type ProviderLogin,
} from '@franciscodlxdev/vue-native-auth-core';

export const TWITCH_ISSUER = 'https://id.twitch.tv/oauth2';
export const TWITCH_AUTHORIZATION_ENDPOINT =
  'https://id.twitch.tv/oauth2/authorize';
/** For your backend: Twitch requires the client secret here. */
export const TWITCH_TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_USERINFO_ENDPOINT = 'https://id.twitch.tv/oauth2/userinfo';
export const TWITCH_JWKS_URI = 'https://id.twitch.tv/oauth2/keys';
/** For your backend: Twitch asks apps to validate tokens at start and hourly. */
export const TWITCH_VALIDATE_ENDPOINT = 'https://id.twitch.tv/oauth2/validate';
export const TWITCH_REVOCATION_ENDPOINT = 'https://id.twitch.tv/oauth2/revoke';

/** `openid` for the id_token, `user:read:email` for the email claims. */
export const TWITCH_DEFAULT_SCOPES = ['openid', 'user:read:email'];

export type TwitchClaim =
  'email' | 'email_verified' | 'picture' | 'preferred_username' | 'updated_at';

export const TWITCH_DEFAULT_CLAIMS: TwitchClaim[] = [
  'email',
  'email_verified',
  'picture',
  'preferred_username',
];

/**
 * Value of the `claims` authorization parameter: Twitch only returns `sub`
 * unless the other claims are requested explicitly. The email claims also
 * need the `user:read:email` scope.
 */
export function twitchClaims(
  claims: TwitchClaim[] = TWITCH_DEFAULT_CLAIMS
): string {
  const requested = Object.fromEntries(claims.map((claim) => [claim, null]));
  return JSON.stringify({ id_token: requested, userinfo: requested });
}

export interface TwitchProfile {
  /** `sub`: the Twitch user id. */
  id: string;
  /** Display name (`preferred_username`). */
  username?: string;
  picture?: string;
  /** Twitch returns no email when it is not verified. */
  email?: string;
  emailVerified?: boolean;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Maps Twitch's userinfo response (or id_token claims) to a profile. */
export function mapTwitchProfile(raw: Record<string, unknown>): TwitchProfile {
  return {
    id: String(raw.sub ?? ''),
    username: text(raw.preferred_username),
    picture: text(raw.picture),
    email: text(raw.email),
    emailVerified:
      typeof raw.email_verified === 'boolean' ? raw.email_verified : undefined,
  };
}

export const twitchProvider: ProviderConfig<TwitchProfile> = {
  id: 'twitch',
  authorizationEndpoint: TWITCH_AUTHORIZATION_ENDPOINT,
  // No tokenEndpoint on purpose: Twitch's authorization code grant needs the
  // client secret, so the code is exchanged by your backend, never by the app.
  issuer: TWITCH_ISSUER,
  defaultScopes: TWITCH_DEFAULT_SCOPES,
  // Twitch does not document PKCE; `state` and the OpenID Connect `nonce` are
  // generated here and the backend checks the nonce inside the id_token.
  usePKCE: false,
  useNonce: true,
  extraAuthParams: { claims: twitchClaims() },
  mapProfile: mapTwitchProfile,
};

/**
 * Builds a Twitch login. Pass overrides to point it at a test server or to
 * change authorization parameters, e.g.
 * `{ extraAuthParams: { claims: twitchClaims(['picture']), force_verify: 'true' } }`.
 */
export function createTwitchLogin(
  overrides: Partial<ProviderConfig<TwitchProfile>> = {}
): ProviderLogin<TwitchProfile> {
  return createProviderLogin({ ...twitchProvider, ...overrides });
}

export const twitchLogin = createTwitchLogin();
