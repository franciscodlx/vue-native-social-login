export {
  createMercadoLibreLogin,
  mapMercadoLibreProfile,
  mercadoLibreAuthorizationEndpoint,
  MERCADOLIBRE_AUTH_HOSTS,
  MERCADOLIBRE_TOKEN_ENDPOINT,
  MERCADOLIBRE_USERINFO_ENDPOINT,
} from './provider';
export type {
  MercadoLibreCountry,
  MercadoLibreLoginOptions,
  MercadoLibreProfile,
} from './provider';
// Same error class and codes as every plugin of the family.
export {
  AuthError,
  isAuthError,
} from '@franciscodlxdev/vue-native-auth-core';
export type {
  AuthErrorCode,
  SignInResult,
} from '@franciscodlxdev/vue-native-auth-core';
