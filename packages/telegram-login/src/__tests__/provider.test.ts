import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import {
  createTelegramLogin,
  mapTelegramProfile,
  telegramLogin,
} from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock = vi.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const options = {
  clientId: '123456789',
  redirectUri: 'https://api.miapp.com/auth/telegram/callback',
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

describe('telegramLogin', () => {
  it('sends an OpenID Connect request with PKCE (S256)', async () => {
    approveWith(native);
    const result = await telegramLogin.signIn(options);
    const { endpoint, params } = sent();

    expect(endpoint).toBe('https://oauth.telegram.org/auth');
    expect(params).toEqual({
      response_type: 'code',
      client_id: '123456789',
      redirect_uri: options.redirectUri,
      scope: 'openid profile',
      state: result.state,
      code_challenge: await native.sha256Base64Url(result.codeVerifier!),
      code_challenge_method: 'S256',
    });
    expect(native.openAuthSession.mock.calls[0]![1]).toBe('miapp://callback');
  });

  it('asks for the phone when the scope is added', async () => {
    approveWith(native);
    await telegramLogin.signIn({
      ...options,
      scopes: ['openid', 'profile', 'phone'],
    });
    expect(sent().params.scope).toBe('openid profile phone');
  });

  it('returns code and verifier for the backend and never a token', async () => {
    approveWith(native);
    const result = await telegramLogin.signIn(options);
    expect(result).toMatchObject({
      code: 'the-code',
      redirectUri: options.redirectUri,
    });
    expect(result.codeVerifier).toBeTruthy();
    expect(result.idToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to exchange the code on the device', async () => {
    await expect(
      telegramLogin.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('reports a rejection as CANCELLED', async () => {
    approveWith(native, { error: 'access_denied' });
    await expect(telegramLogin.signIn(options)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('accepts overrides', async () => {
    approveWith(native);
    await createTelegramLogin({
      authorizationEndpoint: 'http://localhost:4000/authorize',
    }).signIn(options);
    expect(sent().endpoint).toBe('http://localhost:4000/authorize');
  });
});

describe('mapTelegramProfile', () => {
  it('maps the id_token claims', () => {
    expect(
      mapTelegramProfile({
        sub: '1234567890123',
        id: 987654321,
        name: 'Ada Lovelace',
        preferred_username: 'ada',
        picture: 'https://cdn.telegram.org/a.jpg',
        phone_number: '+5215500000000',
      })
    ).toEqual({
      id: '1234567890123',
      telegramId: '987654321',
      name: 'Ada Lovelace',
      username: 'ada',
      picture: 'https://cdn.telegram.org/a.jpg',
      phoneNumber: '+5215500000000',
    });
    expect(mapTelegramProfile({ sub: '1' })).toMatchObject({
      id: '1',
      telegramId: undefined,
      phoneNumber: undefined,
    });
  });
});
