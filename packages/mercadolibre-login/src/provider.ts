import {
  createProviderLogin,
  type ProviderConfig,
  type ProviderLogin,
} from '@franciscodlxdev/vue-native-auth-core';

/**
 * Authorization host per country. The account is tied to one site, so the
 * user must sign in on the host of the country where the account was created.
 */
export const MERCADOLIBRE_AUTH_HOSTS = {
  AR: 'auth.mercadolibre.com.ar',
  BO: 'auth.mercadolibre.com.bo',
  BR: 'auth.mercadolivre.com.br',
  CL: 'auth.mercadolibre.cl',
  CO: 'auth.mercadolibre.com.co',
  CR: 'auth.mercadolibre.co.cr',
  DO: 'auth.mercadolibre.com.do',
  EC: 'auth.mercadolibre.com.ec',
  MX: 'auth.mercadolibre.com.mx',
  PA: 'auth.mercadolibre.com.pa',
  PE: 'auth.mercadolibre.com.pe',
  PY: 'auth.mercadolibre.com.py',
  UY: 'auth.mercadolibre.com.uy',
  VE: 'auth.mercadolibre.com.ve',
} as const;

export type MercadoLibreCountry = keyof typeof MERCADOLIBRE_AUTH_HOSTS;

/** For your backend: the token request needs the client secret. */
export const MERCADOLIBRE_TOKEN_ENDPOINT =
  'https://api.mercadolibre.com/oauth/token';
export const MERCADOLIBRE_USERINFO_ENDPOINT =
  'https://api.mercadolibre.com/users/me';

export function mercadoLibreAuthorizationEndpoint(
  country: MercadoLibreCountry
): string {
  return `https://${MERCADOLIBRE_AUTH_HOSTS[country]}/authorization`;
}

export interface MercadoLibreProfile {
  /** Numeric user id, as a string. */
  id: string;
  nickname?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  /** e.g. `MX`. */
  countryId?: string;
  /** e.g. `MLM`. */
  siteId?: string;
  picture?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Maps the `GET /users/me` response to a profile. */
export function mapMercadoLibreProfile(
  raw: Record<string, unknown>
): MercadoLibreProfile {
  const thumbnail =
    raw.thumbnail && typeof raw.thumbnail === 'object'
      ? (raw.thumbnail as Record<string, unknown>)
      : {};
  return {
    id: String(raw.id ?? ''),
    nickname: text(raw.nickname),
    firstName: text(raw.first_name),
    lastName: text(raw.last_name),
    email: text(raw.email),
    countryId: text(raw.country_id),
    siteId: text(raw.site_id),
    picture: text(thumbnail.picture_url),
  };
}

export interface MercadoLibreLoginOptions extends Partial<
  ProviderConfig<MercadoLibreProfile>
> {
  /** Country of the accounts that will sign in. */
  country: MercadoLibreCountry;
}

/**
 * Builds a Mercado Libre login for one country. Other fields override the
 * provider config, e.g. `authorizationEndpoint` to point at a test server.
 */
export function createMercadoLibreLogin({
  country,
  ...overrides
}: MercadoLibreLoginOptions): ProviderLogin<MercadoLibreProfile> {
  if (!(country in MERCADOLIBRE_AUTH_HOSTS)) {
    throw new Error(`Unknown Mercado Libre country "${country}"`);
  }
  return createProviderLogin({
    id: 'mercadolibre',
    authorizationEndpoint: mercadoLibreAuthorizationEndpoint(country),
    // No tokenEndpoint on purpose: the token request needs the client secret,
    // so the code (and the PKCE verifier) go to your backend.
    //
    // Scopes (read, write, offline_access) are set in the application's
    // settings, not in the request.
    defaultScopes: [],
    // PKCE (S256) stays on, as in the core. Enable it in the application's
    // settings too, so the token endpoint enforces the verifier.
    mapProfile: mapMercadoLibreProfile,
    ...overrides,
  });
}
