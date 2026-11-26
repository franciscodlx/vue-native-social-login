export {
  xLogin,
  xProvider,
  createXLogin,
  mapXProfile,
  xUserInfoUrl,
  X_AUTHORIZATION_ENDPOINT,
  X_TOKEN_ENDPOINT,
  X_REVOCATION_ENDPOINT,
  X_USERINFO_ENDPOINT,
  X_DEFAULT_SCOPES,
  X_OFFLINE_SCOPE,
  X_EMAIL_SCOPE,
} from './provider';
export type { XLogin, XProfile, XRefreshOptions } from './provider';
// Same error class and codes as every plugin of the family.
export {
  AuthError,
  isAuthError,
} from '@franciscodlxdev/vue-native-auth-core';
export type {
  AuthErrorCode,
  SignInOptions,
  SignInResult,
  TokenResponse,
} from '@franciscodlxdev/vue-native-auth-core';
