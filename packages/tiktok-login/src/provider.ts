import {
  createProviderLogin,
  type AuthorizeResult,
  type ProviderConfig,
  type ProviderLogin,
} from '@franciscodlxdev/vue-native-auth-core';

export const TIKTOK_AUTHORIZATION_ENDPOINT =
  'https://www.tiktok.com/v2/auth/authorize/';
/** For your backend: the token request needs the client secret. */
export const TIKTOK_TOKEN_ENDPOINT =
  'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_REVOCATION_ENDPOINT =
  'https://open.tiktokapis.com/v2/oauth/revoke/';
export const TIKTOK_USERINFO_ENDPOINT =
  'https://open.tiktokapis.com/v2/user/info/';

/** Added by default to every app with Login Kit. Other scopes need approval. */
export const TIKTOK_DEFAULT_SCOPES = ['user.info.basic'];

/** Fields of `/v2/user/info/` that `user.info.basic` unlocks. */
export const TIKTOK_BASIC_FIELDS = [
  'open_id',
  'union_id',
  'avatar_url',
  'display_name',
];
/** Fields that need the `user.info.profile` scope. */
export const TIKTOK_PROFILE_FIELDS = [
  'username',
  'bio_description',
  'profile_deep_link',
  'is_verified',
];

/** `/v2/user/info/` URL with the required `fields` parameter. */
export function tikTokUserInfoUrl(
  fields: string[] = TIKTOK_BASIC_FIELDS,
  endpoint: string = TIKTOK_USERINFO_ENDPOINT
): string {
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}fields=${fields.join(',')}`;
}

export interface TikTokProfile {
  /** `open_id`: the user's id for your app. */
  id: string;
  /** Same user across the apps of one developer. */
  unionId?: string;
  displayName?: string;
  picture?: string;
  /** Needs `user.info.profile`. */
  username?: string;
  verified?: boolean;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Maps the `/v2/user/info/` response (`{ data: { user } }`) to a profile. TikTok has no email field. */
export function mapTikTokProfile(raw: Record<string, unknown>): TikTokProfile {
  const data = (raw.data ?? raw) as Record<string, unknown>;
  const user = (
    data.user && typeof data.user === 'object' ? data.user : data
  ) as Record<string, unknown>;
  return {
    id: String(user.open_id ?? ''),
    unionId: text(user.union_id),
    displayName: text(user.display_name),
    picture: text(user.avatar_url),
    username: text(user.username),
    verified:
      typeof user.is_verified === 'boolean' ? user.is_verified : undefined,
  };
}

/** Scopes the user actually granted, from the `scopes` parameter of the redirect. */
export function grantedTikTokScopes(result: AuthorizeResult): string[] {
  return (result.params.scopes ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export const tikTokProvider: ProviderConfig<TikTokProfile> = {
  id: 'tiktok',
  authorizationEndpoint: TIKTOK_AUTHORIZATION_ENDPOINT,
  // No tokenEndpoint on purpose: the token request needs the client secret,
  // so the code is exchanged by your backend, never by the app.
  defaultScopes: TIKTOK_DEFAULT_SCOPES,
  scopeSeparator: ',',
  // TikTok calls the client id "client key".
  clientIdParam: 'client_key',
  // The web flow has no PKCE (TikTok only defines it, hex-encoded, for its
  // desktop and native SDK flows); `state` is generated and verified here.
  usePKCE: false,
  mapProfile: mapTikTokProfile,
};

/**
 * Builds a TikTok login. Pass overrides to point it at a test server or to
 * add authorization parameters, e.g.
 * `{ extraAuthParams: { disable_auto_auth: '1' } }` to always show the
 * authorization page.
 */
export function createTikTokLogin(
  overrides: Partial<ProviderConfig<TikTokProfile>> = {}
): ProviderLogin<TikTokProfile> {
  return createProviderLogin({ ...tikTokProvider, ...overrides });
}

export const tikTokLogin = createTikTokLogin();
