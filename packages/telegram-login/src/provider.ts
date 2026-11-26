import {
  createProviderLogin,
  type ProviderConfig,
  type ProviderLogin,
} from '@franciscodlxdev/vue-native-auth-core';

export const TELEGRAM_ISSUER = 'https://oauth.telegram.org';
export const TELEGRAM_AUTHORIZATION_ENDPOINT =
  'https://oauth.telegram.org/auth';
/** For your backend: the token request needs the client secret from BotFather. */
export const TELEGRAM_TOKEN_ENDPOINT = 'https://oauth.telegram.org/token';
export const TELEGRAM_JWKS_URI =
  'https://oauth.telegram.org/.well-known/jwks.json';

/** `openid` is required; `profile` adds name, username and picture. */
export const TELEGRAM_DEFAULT_SCOPES = ['openid', 'profile'];
/** Adds `phone_number`; the user is asked for consent. */
export const TELEGRAM_PHONE_SCOPE = 'phone';
/** Lets your bot message the user after login. */
export const TELEGRAM_BOT_ACCESS_SCOPE = 'telegram:bot_access';

export interface TelegramProfile {
  /** `sub` of the id_token. */
  id: string;
  /** Numeric Telegram user id (`id` claim), when `profile` was granted. */
  telegramId?: string;
  name?: string;
  /** `preferred_username`, without the `@`. */
  username?: string;
  picture?: string;
  /** Only with the `phone` scope. */
  phoneNumber?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Maps the claims of Telegram's id_token to a profile. Telegram has no
 * userinfo endpoint: the id_token is the only source.
 */
export function mapTelegramProfile(
  raw: Record<string, unknown>
): TelegramProfile {
  return {
    id: String(raw.sub ?? ''),
    telegramId:
      typeof raw.id === 'number' || typeof raw.id === 'string'
        ? String(raw.id)
        : undefined,
    name: text(raw.name),
    username: text(raw.preferred_username),
    picture: text(raw.picture),
    phoneNumber: text(raw.phone_number),
  };
}

export const telegramProvider: ProviderConfig<TelegramProfile> = {
  id: 'telegram',
  authorizationEndpoint: TELEGRAM_AUTHORIZATION_ENDPOINT,
  // No tokenEndpoint on purpose: the token request is authenticated with the
  // client secret, so the code and the PKCE verifier go to your backend.
  issuer: TELEGRAM_ISSUER,
  defaultScopes: TELEGRAM_DEFAULT_SCOPES,
  // PKCE (S256) stays on, as Telegram recommends.
  mapProfile: mapTelegramProfile,
};

/**
 * Builds a Telegram login. Pass overrides to point it at a test server or to
 * change the default scopes.
 */
export function createTelegramLogin(
  overrides: Partial<ProviderConfig<TelegramProfile>> = {}
): ProviderLogin<TelegramProfile> {
  return createProviderLogin({ ...telegramProvider, ...overrides });
}

export const telegramLogin = createTelegramLogin();
