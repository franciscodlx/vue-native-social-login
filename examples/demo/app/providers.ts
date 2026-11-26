import {
  createPresetLogin,
  type PresetName,
} from '@franciscodlxdev/vue-native-oauth-presets';
import { createLinkedInLogin } from '@franciscodlxdev/vue-native-linkedin-login';
import { createMercadoLibreLogin } from '@franciscodlxdev/vue-native-mercadolibre-login';
import { createTelegramLogin } from '@franciscodlxdev/vue-native-telegram-login';
import { createTikTokLogin } from '@franciscodlxdev/vue-native-tiktok-login';
import { createTwitchLogin } from '@franciscodlxdev/vue-native-twitch-login';
import {
  createXLogin,
  X_EMAIL_SCOPE,
} from '@franciscodlxdev/vue-native-x-login';
import type { ProviderLogin } from '@franciscodlxdev/vue-native-auth-core';
import {
  APP_CALLBACKS,
  BACKEND_PUBLIC_URLS,
  CLIENT_IDS,
  HOST,
  LOCAL_BACKEND_PORTS,
  MOCK_IDP,
} from './config';

/** What the screen shows after a sign-in, whatever the provider. */
export interface SignedIn {
  provider: string;
  id: string;
  name?: string;
  username?: string;
  email?: string;
}

export interface DemoProvider {
  id: string;
  label: string;
  color: string;
  /** True when it talks to the real service (a client ID is configured). */
  real: boolean;
  /** `ephemeral`: no cookies shared with the browser (and no iOS consent alert). */
  signIn(ephemeral?: boolean): Promise<SignedIn>;
}

type Backend = keyof typeof LOCAL_BACKEND_PORTS;

function backendUrl(backend: Backend, real: boolean): string {
  return real
    ? BACKEND_PUBLIC_URLS[backend].replace(/\/+$/, '')
    : `http://${HOST}:${LOCAL_BACKEND_PORTS[backend]}`;
}

/** The code is useless to the app: the backend swaps it for the profile. */
async function exchangeOnBackend(
  url: string,
  body: Record<string, string | undefined>
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `BACKEND ERROR: ${json.error_description ?? json.error ?? 'Exchange failed'}`
    );
  }
  return json;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function summary(provider: string, profile: Record<string, unknown>): SignedIn {
  return {
    provider,
    id: String(profile['id'] ?? profile['sub'] ?? ''),
    name: text(profile['name']),
    username: text(profile['username']) ?? text(profile['nickname']),
    email: text(profile['email']),
  };
}

/**
 * Providers whose token request needs the client secret: the browser comes
 * back through the backend (`/auth/<id>/callback` → app scheme) and the
 * backend exchanges the code.
 */
function viaBackend(options: {
  id: string;
  label: string;
  color: string;
  backend: Backend;
  clientId: string;
  /** Path segment of the backend routes; defaults to `id`. */
  route?: string;
  create(
    mock: Partial<{ authorizationEndpoint: string }>
  ): ProviderLogin<Record<string, unknown>>;
  scopes?: string[];
}): DemoProvider {
  const real = options.clientId !== '';
  const route = options.route ?? options.id;
  return {
    id: options.id,
    label: options.label,
    color: options.color,
    real,
    async signIn(ephemeral = false) {
      const base = backendUrl(options.backend, real);
      const login = options.create(
        real ? {} : { authorizationEndpoint: `${MOCK_IDP}/authorize` }
      );
      const result = await login.signIn({
        clientId: real ? options.clientId : 'confidential-app',
        redirectUri: `${base}/auth/${route}/callback`,
        callbackUri: APP_CALLBACKS[options.backend],
        scopes: options.scopes,
        prefersEphemeralSession: ephemeral,
      });
      const body = await exchangeOnBackend(`${base}/auth/${route}/exchange`, {
        code: result.code,
        codeVerifier: result.codeVerifier,
        nonce: result.nonce,
        redirectUri: result.redirectUri,
      });
      return summary(
        options.label,
        (body['profile'] as Record<string, unknown>) ?? {}
      );
    },
  };
}

const asGeneric = <T>(login: ProviderLogin<T>) =>
  login as unknown as ProviderLogin<Record<string, unknown>>;

function preset(name: PresetName, label: string, color: string): DemoProvider {
  return viaBackend({
    id: name,
    label,
    color,
    backend: 'presets',
    clientId: CLIENT_IDS[name],
    create: (mock) => asGeneric(createPresetLogin(name, mock)),
  });
}

const X_REAL = CLIENT_IDS.x !== '';

/**
 * X: public client, the app exchanges the code itself (PKCE, no secret).
 * Exported apart from PROVIDERS because Home.vue drives it with the
 * `useProviderLogin` composable instead of the generic session state.
 */
export const X_LOGIN = createXLogin(
  X_REAL
    ? {}
    : {
        authorizationEndpoint: `${MOCK_IDP}/authorize`,
        tokenEndpoint: `${MOCK_IDP}/token`,
        userInfoEndpoint: `${MOCK_IDP}/2/users/me`,
        revocationEndpoint: `${MOCK_IDP}/revoke`,
      }
);

export const X_OPTIONS = {
  clientId: X_REAL ? CLIENT_IDS.x : 'example-app',
  redirectUri: APP_CALLBACKS.x,
  scopes: ['users.read', 'tweet.read', X_EMAIL_SCOPE, 'offline.access'],
  exchangeCode: true,
};

export const X_PROVIDER = { label: 'X', color: '#000000', real: X_REAL };

export function xSummary(profile: object | undefined): SignedIn {
  if (!profile) {
    throw new Error('X returned no profile');
  }
  return summary('X', { ...profile });
}

export const PROVIDERS: DemoProvider[] = [
  viaBackend({
    id: 'linkedin',
    label: 'LinkedIn',
    color: '#0a66c2',
    backend: 'linkedin',
    clientId: CLIENT_IDS.linkedin,
    create: (mock) => asGeneric(createLinkedInLogin(mock)),
  }),
  viaBackend({
    id: 'mercadolibre',
    label: 'Mercado Libre',
    color: '#2d3277',
    backend: 'mercadolibre',
    clientId: CLIENT_IDS.mercadolibre,
    create: (mock) =>
      asGeneric(createMercadoLibreLogin({ country: 'MX', ...mock })),
  }),
  viaBackend({
    id: 'twitch',
    label: 'Twitch',
    color: '#9146ff',
    backend: 'twitch',
    clientId: CLIENT_IDS.twitch,
    create: (mock) => asGeneric(createTwitchLogin(mock)),
  }),
  preset('github', 'GitHub', '#24292f'),
  preset('discord', 'Discord', '#5865f2'),
  preset('slack', 'Slack', '#4a154b'),
  preset('strava', 'Strava', '#fc4c02'),
  viaBackend({
    id: 'telegram',
    label: 'Telegram',
    color: '#229ed9',
    backend: 'telegram',
    clientId: CLIENT_IDS.telegram,
    create: (mock) => asGeneric(createTelegramLogin(mock)),
    scopes: ['openid', 'profile', 'phone'],
  }),
  viaBackend({
    id: 'tiktok',
    label: 'TikTok',
    color: '#111111',
    backend: 'tiktok',
    clientId: CLIENT_IDS.tiktok,
    create: (mock) => asGeneric(createTikTokLogin(mock)),
  }),
];
