import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import {
  createMercadoLibreLogin,
  mapMercadoLibreProfile,
  mercadoLibreAuthorizationEndpoint,
} from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock = vi.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const options = {
  clientId: '1234567890',
  redirectUri: 'https://api.miapp.com/auth/mercadolibre/callback',
  callbackUri: 'miapp://callback',
};

function sent() {
  const url = native.openAuthSession.mock.calls[0]![0];
  const [endpoint, query = ''] = url.split('?');
  return { endpoint, params: decodeParams(query) };
}

beforeEach(() => {
  native.openAuthSession.mockReset();
  fetchMock.mockReset();
});

describe('createMercadoLibreLogin', () => {
  it('uses the authorization host of the country', () => {
    expect(mercadoLibreAuthorizationEndpoint('MX')).toBe(
      'https://auth.mercadolibre.com.mx/authorization'
    );
    expect(mercadoLibreAuthorizationEndpoint('BR')).toBe(
      'https://auth.mercadolivre.com.br/authorization'
    );
    expect(mercadoLibreAuthorizationEndpoint('CL')).toBe(
      'https://auth.mercadolibre.cl/authorization'
    );
    expect(() => createMercadoLibreLogin({ country: 'XX' as never })).toThrow(
      'Unknown Mercado Libre country'
    );
  });

  it('sends state and PKCE, no scope, and waits on the app callback', async () => {
    approveWith(native);
    const result = await createMercadoLibreLogin({ country: 'MX' }).signIn(
      options
    );
    const { endpoint, params } = sent();

    expect(endpoint).toBe('https://auth.mercadolibre.com.mx/authorization');
    expect(params).toEqual({
      response_type: 'code',
      client_id: '1234567890',
      redirect_uri: options.redirectUri,
      state: result.state,
      code_challenge: await native.sha256Base64Url(result.codeVerifier!),
      code_challenge_method: 'S256',
    });
    expect(native.openAuthSession.mock.calls[0]![1]).toBe('miapp://callback');
  });

  it('returns code and verifier for the backend and never a token', async () => {
    approveWith(native);
    const result = await createMercadoLibreLogin({ country: 'AR' }).signIn(
      options
    );
    expect(result).toMatchObject({
      code: 'the-code',
      redirectUri: options.redirectUri,
    });
    expect(result.codeVerifier).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to exchange the code on the device', async () => {
    await expect(
      createMercadoLibreLogin({ country: 'MX' }).signIn({
        ...options,
        exchangeCode: true,
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(native.openAuthSession).not.toHaveBeenCalled();
  });

  it('reports a rejection as CANCELLED', async () => {
    approveWith(native, { error: 'access_denied' });
    await expect(
      createMercadoLibreLogin({ country: 'MX' }).signIn(options)
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('accepts overrides for a test server', async () => {
    approveWith(native);
    await createMercadoLibreLogin({
      country: 'MX',
      authorizationEndpoint: 'http://localhost:4000/authorize',
    }).signIn(options);
    expect(sent().endpoint).toBe('http://localhost:4000/authorize');
  });
});

describe('mapMercadoLibreProfile', () => {
  it('maps /users/me', () => {
    expect(
      mapMercadoLibreProfile({
        id: 202593498,
        nickname: 'TETE2870021',
        first_name: 'Test',
        last_name: 'Test',
        email: 'test_user@testuser.com',
        country_id: 'MX',
        site_id: 'MLM',
        thumbnail: { picture_id: 'x', picture_url: 'https://img/x.jpg' },
      })
    ).toEqual({
      id: '202593498',
      nickname: 'TETE2870021',
      firstName: 'Test',
      lastName: 'Test',
      email: 'test_user@testuser.com',
      countryId: 'MX',
      siteId: 'MLM',
      picture: 'https://img/x.jpg',
    });
    expect(mapMercadoLibreProfile({ id: 1 })).toMatchObject({
      id: '1',
      picture: undefined,
    });
  });
});
