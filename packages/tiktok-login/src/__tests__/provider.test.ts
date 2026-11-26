import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import {
  createTikTokLogin,
  grantedTikTokScopes,
  mapTikTokProfile,
  tikTokLogin,
  tikTokUserInfoUrl,
} from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock = vi.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const options = {
  clientId: 'awx1234567890',
  redirectUri: 'https://api.miapp.com/auth/tiktok/callback',
  callbackUri: 'miapp://callback',
};

function sent() {
  const url = native.openAuthSession.mock.calls[0]![0];
  const at = url.indexOf('?');
  return {
    endpoint: url.slice(0, at),
    params: decodeParams(url.slice(at + 1)),
  };
}

beforeEach(() => {
  native.openAuthSession.mockReset();
  fetchMock.mockReset();
});

describe('tikTokLogin', () => {
  it('sends client_key, comma-separated scopes and state, without PKCE', async () => {
    approveWith(native);
    const result = await tikTokLogin.signIn({
      ...options,
      scopes: ['user.info.basic', 'user.info.profile'],
    });
    const { endpoint, params } = sent();

    expect(endpoint).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(params).toEqual({
      response_type: 'code',
      client_key: 'awx1234567890',
      redirect_uri: options.redirectUri,
      scope: 'user.info.basic,user.info.profile',
      state: result.state,
    });
    expect(result.codeVerifier).toBeUndefined();
    expect(native.openAuthSession.mock.calls[0]![1]).toBe('miapp://callback');
  });

  it('returns the code and the granted scopes, never a token', async () => {
    approveWith(native, {
      code: 'the-code',
      scopes: 'user.info.basic,user.info.profile',
    });
    const result = await tikTokLogin.signIn(options);
    expect(result.code).toBe('the-code');
    expect(grantedTikTokScopes(result)).toEqual([
      'user.info.basic',
      'user.info.profile',
    ]);
    expect(result.accessToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to exchange the code on the device', async () => {
    await expect(
      tikTokLogin.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('reports a rejection as CANCELLED', async () => {
    approveWith(native, { error: 'access_denied' });
    await expect(tikTokLogin.signIn(options)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('accepts overrides', async () => {
    approveWith(native);
    await createTikTokLogin({
      authorizationEndpoint: 'http://localhost:4000/authorize',
      extraAuthParams: { disable_auto_auth: '1' },
    }).signIn(options);
    expect(sent().endpoint).toBe('http://localhost:4000/authorize');
    expect(sent().params.disable_auto_auth).toBe('1');
  });
});

describe('helpers', () => {
  it('maps /v2/user/info/', () => {
    expect(
      mapTikTokProfile({
        data: {
          user: {
            open_id: '723f24d7-e717-40f8-a2b6-cb8464cd23b4',
            union_id: 'c9c60f44-a68e-4f5d-84dd-ce22faeb0ba1',
            avatar_url: 'https://p19-sign.tiktokcdn-us.com/a.jpeg',
            display_name: 'Ada',
          },
        },
        error: { code: 'ok', message: '', log_id: 'x' },
      })
    ).toEqual({
      id: '723f24d7-e717-40f8-a2b6-cb8464cd23b4',
      unionId: 'c9c60f44-a68e-4f5d-84dd-ce22faeb0ba1',
      displayName: 'Ada',
      picture: 'https://p19-sign.tiktokcdn-us.com/a.jpeg',
      username: undefined,
      verified: undefined,
    });
  });

  it('builds the user info URL with the fields parameter', () => {
    expect(tikTokUserInfoUrl()).toBe(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name'
    );
    expect(tikTokUserInfoUrl(['open_id', 'username'])).toContain(
      'fields=open_id,username'
    );
  });
});
