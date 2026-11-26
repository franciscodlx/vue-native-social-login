import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  jsonResponse,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import { createXLogin, mapXProfile, xLogin, xUserInfoUrl } from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock =
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const options = { clientId: 'x-client', redirectUri: 'miapp://callback' };

const USER = {
  data: {
    id: '2244994945',
    name: 'X Dev',
    username: 'XDevelopers',
    profile_image_url: 'https://pbs.twimg.com/a_normal.jpg',
    verified: true,
  },
};

function sent() {
  const url = native.openAuthSession.mock.calls[0]![0];
  const [endpoint, query = ''] = url.split('?');
  return { endpoint, params: decodeParams(query) };
}

/** Answers the token, users/me and revoke endpoints like X does. */
function serveX(
  user: unknown = USER,
  tokens: Record<string, unknown> = {
    token_type: 'bearer',
    expires_in: 7200,
    access_token: 'at-1',
    scope: 'users.read tweet.read',
  }
) {
  fetchMock.mockImplementation(async (url) => {
    if (url === 'https://api.x.com/2/oauth2/token') {
      return jsonResponse(tokens);
    }
    if (url.startsWith('https://api.x.com/2/users/me')) {
      return jsonResponse(user);
    }
    return jsonResponse({ revoked: true });
  });
}

const callsTo = (prefix: string) =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith(prefix));

beforeEach(() => {
  native.openAuthSession.mockReset();
  fetchMock.mockReset();
});

describe('xLogin.signIn', () => {
  it('sends an OAuth 2.0 + PKCE (S256) request to x.com', async () => {
    approveWith(native);
    const result = await xLogin.signIn(options);
    const { endpoint, params } = sent();

    expect(endpoint).toBe('https://x.com/i/oauth2/authorize');
    expect(params).toEqual({
      response_type: 'code',
      client_id: 'x-client',
      redirect_uri: 'miapp://callback',
      scope: 'users.read tweet.read',
      state: result.state,
      code_challenge: await native.sha256Base64Url(result.codeVerifier!),
      code_challenge_method: 'S256',
    });
    expect(params.nonce).toBeUndefined();
  });

  it('returns code and verifier for a backend exchange by default', async () => {
    approveWith(native);
    const result = await xLogin.signIn(options);
    expect(result).toMatchObject({
      code: 'the-code',
      redirectUri: 'miapp://callback',
    });
    expect(result.codeVerifier).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges on-device as a public client: client_id in the body, no secret, no Authorization', async () => {
    approveWith(native);
    serveX();
    const result = await xLogin.signIn({ ...options, exchangeCode: true });

    const [, init] = callsTo('https://api.x.com/2/oauth2/token')[0]!;
    expect(decodeParams(init.body as string)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'miapp://callback',
      client_id: 'x-client',
      code_verifier: result.codeVerifier,
    });
    expect(
      (init.headers as Record<string, string>).Authorization
    ).toBeUndefined();
    expect(result.accessToken).toBe('at-1');
    expect(result.expiresIn).toBe(7200);
    expect(result.refreshToken).toBeUndefined();
    expect(result.profile).toEqual({
      id: '2244994945',
      username: 'XDevelopers',
      name: 'X Dev',
      picture: 'https://pbs.twimg.com/a_normal.jpg',
      verified: true,
      email: undefined,
    });
  });

  it('asks for confirmed_email only when users.email was requested', async () => {
    approveWith(native);
    serveX();
    await xLogin.signIn({ ...options, exchangeCode: true });
    expect(callsTo('https://api.x.com/2/users/me')[0]![0]).toBe(
      'https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,verified'
    );

    fetchMock.mockClear();
    serveX({ data: { ...USER.data, confirmed_email: 'dev@example.com' } });
    const result = await xLogin.signIn({
      ...options,
      exchangeCode: true,
      scopes: ['users.read', 'tweet.read', 'users.email'],
    });
    expect(callsTo('https://api.x.com/2/users/me')[0]![0]).toContain(
      ',confirmed_email'
    );
    expect(result.profile?.email).toBe('dev@example.com');
  });

  it('returns the refresh token when offline.access is requested', async () => {
    approveWith(native);
    serveX(USER, { access_token: 'at-1', refresh_token: 'rt-1' });
    const result = await xLogin.signIn({
      ...options,
      exchangeCode: true,
      scopes: ['users.read', 'tweet.read', 'offline.access'],
    });
    expect(sent().params.scope).toBe('users.read tweet.read offline.access');
    expect(result.refreshToken).toBe('rt-1');
  });

  it('reports a rejection as CANCELLED', async () => {
    approveWith(native, { error: 'access_denied' });
    await expect(xLogin.signIn(options)).rejects.toMatchObject({
      code: 'CANCELLED',
      providerError: 'access_denied',
    });
  });

  it('surfaces X token errors as PROVIDER_ERROR', async () => {
    approveWith(native);
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: 'invalid_request',
          error_description:
            'Value passed for the authorization code was invalid.',
        },
        400
      )
    );
    await expect(
      xLogin.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      providerError: 'invalid_request',
      status: 400,
    });
  });
});

describe('refresh and signOut', () => {
  it('refreshes as a public client', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: 'at-2', refresh_token: 'rt-2' })
    );
    const tokens = await xLogin.refresh({
      clientId: 'x-client',
      refreshToken: 'rt-1',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.x.com/2/oauth2/token');
    expect(decodeParams(init.body as string)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt-1',
      client_id: 'x-client',
    });
    expect(tokens).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
  });

  it('revokes the token on signOut', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revoked: true }));
    await xLogin.signOut({ clientId: 'x-client', token: 'at-1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.x.com/2/oauth2/revoke');
    expect(decodeParams(init.body as string)).toEqual({
      token: 'at-1',
      client_id: 'x-client',
    });
  });

  it('uses the overridden endpoints of a custom instance', async () => {
    approveWith(native);
    const login = createXLogin({
      authorizationEndpoint: 'http://localhost:4000/authorize',
      tokenEndpoint: 'http://localhost:4000/token',
    });
    await login.signIn(options);
    expect(sent().endpoint).toBe('http://localhost:4000/authorize');

    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'at-2' }));
    await login.refresh({ clientId: 'x-client', refreshToken: 'rt-1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:4000/token');
  });
});

describe('mapXProfile / xUserInfoUrl', () => {
  it('accepts the enveloped and the bare user object', () => {
    expect(mapXProfile(USER).username).toBe('XDevelopers');
    expect(mapXProfile(USER.data).id).toBe('2244994945');
  });

  it('keeps an existing query string', () => {
    expect(xUserInfoUrl('https://h/2/users/me?x=1', ['users.read'])).toBe(
      'https://h/2/users/me?x=1&user.fields=id,name,username,profile_image_url,verified'
    );
  });
});
