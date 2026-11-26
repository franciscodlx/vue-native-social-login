import { beforeEach, describe, expect, it } from 'vitest';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import {
  createLinkedInLogin,
  linkedInLogin,
  mapLinkedInProfile,
} from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);

const options = {
  clientId: '86abc',
  redirectUri: 'https://api.miapp.com/auth/linkedin/callback',
  callbackUri: 'miapp://callback',
};

function sent() {
  const url = native.openAuthSession.mock.calls[0]![0];
  const [endpoint, query = ''] = url.split('?');
  const params = Object.fromEntries(
    query.split('&').map((pair) => pair.split('=').map(decodeURIComponent))
  ) as Record<string, string>;
  return { endpoint, params };
}

beforeEach(() => native.openAuthSession.mockReset());

describe('linkedInLogin', () => {
  it('requests the OpenID Connect scopes at the LinkedIn endpoint, without PKCE or nonce', async () => {
    approveWith(native);
    const result = await linkedInLogin.signIn(options);
    const { endpoint, params } = sent();

    expect(endpoint).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(params).toEqual({
      response_type: 'code',
      client_id: '86abc',
      redirect_uri: options.redirectUri,
      scope: 'openid profile email',
      state: result.state,
    });
    expect(native.openAuthSession.mock.calls[0]![1]).toBe('miapp://callback');
  });

  it('returns what the backend needs and never a token', async () => {
    approveWith(native);
    const result = await linkedInLogin.signIn(options);
    expect(result).toMatchObject({
      code: 'the-code',
      redirectUri: options.redirectUri,
    });
    expect(result.codeVerifier).toBeUndefined();
    expect(result.accessToken).toBeUndefined();
  });

  it('refuses to exchange the code on the device', async () => {
    await expect(
      linkedInLogin.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(native.openAuthSession).not.toHaveBeenCalled();
  });

  it.each(['user_cancelled_login', 'user_cancelled_authorize'])(
    'reports %s as CANCELLED',
    async (error) => {
      approveWith(native, { error, error_description: 'The user cancelled' });
      await expect(linkedInLogin.signIn(options)).rejects.toMatchObject({
        code: 'CANCELLED',
        providerError: error,
      });
    }
  );

  it('accepts overrides for extra parameters and test servers', async () => {
    approveWith(native);
    const login = createLinkedInLogin({
      authorizationEndpoint: 'http://localhost:4000/authorize',
      extraAuthParams: { enable_extended_login: 'true' },
    });
    await login.signIn({ ...options, scopes: ['openid'] });
    const { endpoint, params } = sent();
    expect(endpoint).toBe('http://localhost:4000/authorize');
    expect(params.enable_extended_login).toBe('true');
    expect(params.scope).toBe('openid');
  });
});

describe('mapLinkedInProfile', () => {
  it('maps the userinfo response', () => {
    expect(
      mapLinkedInProfile({
        sub: '782bbtaQ',
        name: 'John Doe',
        given_name: 'John',
        family_name: 'Doe',
        picture: 'https://media.licdn.com/p.jpg',
        locale: 'en-US',
        email: 'doe@email.com',
        email_verified: true,
      })
    ).toEqual({
      id: '782bbtaQ',
      name: 'John Doe',
      givenName: 'John',
      familyName: 'Doe',
      picture: 'https://media.licdn.com/p.jpg',
      locale: 'en-US',
      email: 'doe@email.com',
      emailVerified: true,
    });
  });

  it('handles the object locale and a missing email', () => {
    expect(
      mapLinkedInProfile({
        sub: 'x',
        locale: { language: 'es', country: 'MX' },
      })
    ).toEqual({
      id: 'x',
      name: undefined,
      givenName: undefined,
      familyName: undefined,
      picture: undefined,
      locale: 'es-MX',
      email: undefined,
      emailVerified: undefined,
    });
  });
});
