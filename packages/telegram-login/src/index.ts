export {
  telegramLogin,
  telegramProvider,
  createTelegramLogin,
  mapTelegramProfile,
  TELEGRAM_ISSUER,
  TELEGRAM_AUTHORIZATION_ENDPOINT,
  TELEGRAM_TOKEN_ENDPOINT,
  TELEGRAM_JWKS_URI,
  TELEGRAM_DEFAULT_SCOPES,
  TELEGRAM_PHONE_SCOPE,
  TELEGRAM_BOT_ACCESS_SCOPE,
} from './provider';
export type { TelegramProfile } from './provider';
// Same error class and codes as every plugin of the family.
export {
  AuthError,
  isAuthError,
} from '@franciscodlxdev/vue-native-auth-core';
export type {
  AuthErrorCode,
  SignInResult,
} from '@franciscodlxdev/vue-native-auth-core';
