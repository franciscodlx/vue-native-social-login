import type { ProviderConfig } from '@franciscodlxdev/vue-native-auth-core';

/** Profile shape shared by every preset. `raw` keeps the provider's object. */
export interface PresetProfile {
  id: string;
  username?: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  picture?: string;
  raw: Record<string, unknown>;
}

export interface Preset extends ProviderConfig<PresetProfile> {
  /**
   * Endpoints your backend needs. They are not used by the app: all four
   * providers require the client secret to exchange the code.
   */
  backend: {
    tokenEndpoint: string;
    userInfoEndpoint?: string;
    revocationEndpoint?: string;
    jwksUri?: string;
  };
  /** Expected `iss` parameter of the redirect (RFC 9207), when the provider sends it. */
  redirectIssuer?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const id = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** `GET https://api.github.com/user`. `email` is null when it is private. */
export function mapGitHubProfile(raw: Record<string, unknown>): PresetProfile {
  return {
    id: id(raw.id),
    username: text(raw.login),
    name: text(raw.name),
    email: text(raw.email),
    picture: text(raw.avatar_url),
    raw,
  };
}

/** `GET https://discord.com/api/users/@me`. */
export function mapDiscordProfile(raw: Record<string, unknown>): PresetProfile {
  const userId = id(raw.id);
  const avatar = text(raw.avatar);
  return {
    id: userId,
    username: text(raw.username),
    name: text(raw.global_name),
    email: text(raw.email),
    emailVerified: bool(raw.verified),
    picture: avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`
      : undefined,
    raw,
  };
}

/** Slack's `openid.connect.userInfo` response or id_token claims. */
export function mapSlackProfile(raw: Record<string, unknown>): PresetProfile {
  return {
    id: id(raw.sub),
    name: text(raw.name),
    email: text(raw.email),
    emailVerified: bool(raw.email_verified),
    picture: text(raw.picture),
    raw,
  };
}

/** The `athlete` object of Strava's token response. */
export function mapStravaProfile(raw: Record<string, unknown>): PresetProfile {
  const name = [text(raw.firstname), text(raw.lastname)]
    .filter(Boolean)
    .join(' ');
  return {
    id: id(raw.id),
    username: text(raw.username),
    name: name || undefined,
    picture: text(raw.profile),
    raw,
  };
}

export const github: Preset = {
  id: 'github',
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  defaultScopes: ['read:user', 'user:email'],
  // PKCE (S256) on: GitHub supports it, and still requires the secret.
  mapProfile: mapGitHubProfile,
  backend: {
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    userInfoEndpoint: 'https://api.github.com/user',
  },
};

export const discord: Preset = {
  id: 'discord',
  authorizationEndpoint: 'https://discord.com/oauth2/authorize',
  defaultScopes: ['identify', 'email'],
  // PKCE on, as Discord recommends for production apps.
  mapProfile: mapDiscordProfile,
  redirectIssuer: 'https://discord.com',
  backend: {
    tokenEndpoint: 'https://discord.com/api/oauth2/token',
    userInfoEndpoint: 'https://discord.com/api/users/@me',
    revocationEndpoint: 'https://discord.com/api/oauth2/token/revoke',
  },
};

/** Sign in with Slack (OpenID Connect). */
export const slack: Preset = {
  id: 'slack',
  authorizationEndpoint: 'https://slack.com/openid/connect/authorize',
  issuer: 'https://slack.com',
  defaultScopes: ['openid', 'profile', 'email'],
  // Slack documents `nonce` for this flow but not `code_challenge`.
  usePKCE: false,
  useNonce: true,
  mapProfile: mapSlackProfile,
  backend: {
    tokenEndpoint: 'https://slack.com/api/openid.connect.token',
    userInfoEndpoint: 'https://slack.com/api/openid.connect.userInfo',
    jwksUri: 'https://slack.com/openid/connect/keys',
  },
};

export const strava: Preset = {
  id: 'strava',
  // The mobile endpoint falls back to the web page when the Strava app is
  // not installed.
  authorizationEndpoint: 'https://www.strava.com/oauth/mobile/authorize',
  defaultScopes: ['read'],
  scopeSeparator: ',',
  // Strava does not document PKCE.
  usePKCE: false,
  extraAuthParams: { approval_prompt: 'auto' },
  mapProfile: mapStravaProfile,
  backend: {
    tokenEndpoint: 'https://www.strava.com/oauth/token',
    revocationEndpoint: 'https://www.strava.com/oauth/revoke',
  },
};

export const presets = { github, discord, slack, strava } as const;
export type PresetName = keyof typeof presets;
