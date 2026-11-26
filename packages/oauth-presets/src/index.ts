export {
  presets,
  github,
  discord,
  slack,
  strava,
  mapGitHubProfile,
  mapDiscordProfile,
  mapSlackProfile,
  mapStravaProfile,
} from './presets';
export type { Preset, PresetName, PresetProfile } from './presets';
export {
  createPresetLogin,
  githubLogin,
  discordLogin,
  slackLogin,
  stravaLogin,
} from './login';
export type { PresetSignInOptions } from './login';
// Same error class and codes as every plugin of the family.
export {
  AuthError,
  isAuthError,
} from '@franciscodlxdev/vue-native-auth-core';
export type {
  AuthErrorCode,
  SignInResult,
} from '@franciscodlxdev/vue-native-auth-core';
