import {
  createProviderLogin,
  type ProviderConfig,
  type ProviderLogin,
} from '@franciscodlxdev/vue-native-auth-core';

export const LINKEDIN_ISSUER = 'https://www.linkedin.com/oauth';
export const LINKEDIN_AUTHORIZATION_ENDPOINT =
  'https://www.linkedin.com/oauth/v2/authorization';
/** For your backend: LinkedIn requires the client secret here. */
export const LINKEDIN_TOKEN_ENDPOINT =
  'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_ENDPOINT =
  'https://api.linkedin.com/v2/userinfo';
export const LINKEDIN_JWKS_URI = 'https://www.linkedin.com/oauth/openid/jwks';

/** Scopes of "Sign In with LinkedIn using OpenID Connect". */
export const LINKEDIN_DEFAULT_SCOPES = ['openid', 'profile', 'email'];

export interface LinkedInProfile {
  /** `sub`: stable, app-specific member id. */
  id: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  /** BCP 47 tag, e.g. `es-MX`. */
  locale?: string;
  /** Not present in every response. */
  email?: string;
  emailVerified?: boolean;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function readLocale(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return text(value);
  }
  // LinkedIn has also returned { language: "es", country: "MX" }.
  if (value && typeof value === 'object') {
    const { language, country } = value as Record<string, unknown>;
    const parts = [text(language), text(country)].filter(Boolean);
    return parts.length > 0 ? parts.join('-') : undefined;
  }
  return undefined;
}

/** Maps LinkedIn's userinfo response (or id_token claims) to a profile. */
export function mapLinkedInProfile(
  raw: Record<string, unknown>
): LinkedInProfile {
  return {
    id: String(raw.sub ?? ''),
    name: text(raw.name),
    givenName: text(raw.given_name),
    familyName: text(raw.family_name),
    picture: text(raw.picture),
    locale: readLocale(raw.locale),
    email: text(raw.email),
    emailVerified:
      typeof raw.email_verified === 'boolean'
        ? raw.email_verified
        : raw.email_verified === 'true'
          ? true
          : undefined,
  };
}

export const linkedInProvider: ProviderConfig<LinkedInProfile> = {
  id: 'linkedin',
  authorizationEndpoint: LINKEDIN_AUTHORIZATION_ENDPOINT,
  // No tokenEndpoint on purpose: LinkedIn's token request needs the client
  // secret, so the code is exchanged by your backend, never by the app.
  issuer: LINKEDIN_ISSUER,
  defaultScopes: LINKEDIN_DEFAULT_SCOPES,
  // LinkedIn documents neither PKCE nor `nonce` for this flow; `state` is
  // still generated and verified by the core.
  usePKCE: false,
  useNonce: false,
  cancelErrors: ['user_cancelled_login', 'user_cancelled_authorize'],
  mapProfile: mapLinkedInProfile,
};

/**
 * Builds a LinkedIn login. Pass overrides to point it at a test server or to
 * add authorization parameters (e.g. `{ enable_extended_login: 'true' }`).
 */
export function createLinkedInLogin(
  overrides: Partial<ProviderConfig<LinkedInProfile>> = {}
): ProviderLogin<LinkedInProfile> {
  return createProviderLogin({ ...linkedInProvider, ...overrides });
}

export const linkedInLogin = createLinkedInLogin();
