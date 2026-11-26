import {
  AuthError,
  createProviderLogin,
  type ProviderConfig,
  type ProviderLogin,
  type SignInOptions,
} from '@franciscodlxdev/vue-native-auth-core';
import {
  presets,
  type Preset,
  type PresetName,
  type PresetProfile,
} from './presets';

export type PresetSignInOptions = Omit<SignInOptions, 'exchangeCode'>;

/**
 * Builds the login of a preset. Overrides replace fields of the provider
 * config, e.g. `{ defaultScopes: ['identify'] }` or a test server's
 * `authorizationEndpoint`.
 */
export function createPresetLogin(
  preset: PresetName | Preset,
  overrides: Partial<ProviderConfig<PresetProfile>> = {}
): ProviderLogin<PresetProfile> {
  const config = typeof preset === 'string' ? presets[preset] : preset;
  if (!config) {
    throw new Error(`Unknown preset "${String(preset)}"`);
  }
  // `backend` and `redirectIssuer` are ours, not part of the core's config.
  const { redirectIssuer } = config;
  const provider: ProviderConfig<PresetProfile> & Partial<Preset> = {
    ...config,
  };
  delete provider.backend;
  delete provider.redirectIssuer;
  const base = createProviderLogin({ ...provider, ...overrides });

  return {
    ...base,
    async signIn(options: SignInOptions) {
      const result = await base.signIn(options);
      // RFC 9207: a response carrying another issuer was not meant for us.
      if (
        redirectIssuer &&
        result.params.iss !== undefined &&
        result.params.iss !== redirectIssuer
      ) {
        throw new AuthError(
          'PROVIDER_ERROR',
          'The response came from an unexpected issuer'
        );
      }
      return result;
    },
  };
}

export const githubLogin = createPresetLogin('github');
export const discordLogin = createPresetLogin('discord');
export const slackLogin = createPresetLogin('slack');
export const stravaLogin = createPresetLogin('strava');
