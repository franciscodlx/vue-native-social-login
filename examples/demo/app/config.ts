import { usePlatform } from '@thelacanians/vue-native-runtime';

const { isAndroid } = usePlatform();

/**
 * Client IDs per provider. Leave one empty to try that provider against the
 * local mocks (tools/mock-idp + tools/<provider>-backend); fill it in, and its
 * secret in the backend's .env, to use the real service.
 *
 * Only public values go here: client secrets live in the backends.
 */
export const CLIENT_IDS = {
  linkedin: '',
  /** X is a public client: no backend, the app exchanges the code (PKCE). */
  x: '',
  mercadolibre: '',
  twitch: '',
  github: '',
  discord: '',
  slack: '',
  strava: '',
  /** Bot ID from @BotFather. */
  telegram: '',
  /** "Client key" in the TikTok developer portal. */
  tiktok: '',
};

/**
 * Public https URL (tunnel) of each backend that has real credentials. One
 * tunnel per backend: they listen on different ports.
 */
export const BACKEND_PUBLIC_URLS = {
  linkedin: '',
  mercadolibre: '',
  twitch: '',
  presets: '',
  telegram: '',
  tiktok: '',
};

/** Microsoft Entra External ID (native authentication). Empty: tools/mock-entra. */
export const ENTRA = { tenantSubdomain: '', clientId: '' };

// The Android emulator reaches the host machine through 10.0.2.2.
export const HOST = isAndroid ? '10.0.2.2' : 'localhost';
export const MOCK_IDP = `http://${HOST}:4000`;

/** Local port of each backend (see tools/*-backend/.env.example). */
export const LOCAL_BACKEND_PORTS = {
  linkedin: 4100,
  mercadolibre: 4200,
  twitch: 4300,
  presets: 4400,
  telegram: 4500,
  tiktok: 4600,
};

/**
 * Where the browser hands the result back to the app. The same schemes as the
 * React Native, Flutter and NativeScript examples, so the backends' APP_CALLBACK and the
 * redirect URIs already registered in each provider keep working. `pnpm setup:native` declares them for
 * Android (see package.json).
 */
export const APP_CALLBACKS = {
  linkedin: 'linkedinexample://callback',
  x: 'xloginexample://callback',
  mercadolibre: 'meliexample://callback',
  twitch: 'twitchexample://callback',
  presets: 'presetsexample://callback',
  telegram: 'telegramexample://callback',
  tiktok: 'tiktokexample://callback',
  entra: 'entraexample://callback',
};
