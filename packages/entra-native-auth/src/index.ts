export { createEntraNativeAuth } from './client';
export type {
  AttributesRequiredStep,
  BrowserRequiredStep,
  BrowserSignInOptions,
  CodeRequiredStep,
  EntraFlow,
  EntraNativeAuth,
  EntraNativeAuthConfig,
  EntraProfile,
  EntraStep,
  EntraTokens,
  NewPasswordRequiredStep,
  PasswordRequiredStep,
  SignedInStep,
} from './client';
export { EntraAuthError, isEntraAuthError } from './errors';
export type { RequiredAttribute } from './errors';
// Same error class and codes as every plugin of the family.
export {
  AuthError,
  isAuthError,
} from '@franciscodlxdev/vue-native-auth-core';
export type { AuthErrorCode } from '@franciscodlxdev/vue-native-auth-core';
