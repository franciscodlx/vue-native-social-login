import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import {
  createTwitchLogin,
  mapTwitchProfile,
  twitchClaims,
  twitchLogin,
} from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock = vi.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const options = {
  clientId: 'hof5gwx0su6owfnys0yan9c87zr6t',
  redirectUri: 'https://api.miapp.com/auth/twitch/callback',
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

describe('twitchLogin', () => {
  it('sends an OpenID Connect request with nonce and claims, without PKCE', async () => {
    approveWith(native);
    const result = await twitchLogin.signIn(options);
    const { endpoint, params } = sent();

    expect(endpoint).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(params).toEqual({
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      scope: 'openid user:read:email',
      state: result.state,
      nonce: result.nonce,
      claims:
        '{"id_token":{"email":null,"email_verified":null,"picture":null,"preferred_username":null},"userinfo":{"email":null,"email_verified":null,"picture":null,"preferred_username":null}}',
    });
    expect(result.nonce).toBeTruthy();
    expect(native.openAuthSession.mock.calls[0]![1]).toBe('miapp://callback');
  });

  it('returns what the backend needs and never a token', async () => {
    approveWith(native);
    const result = await twitchLogin.signIn(options);
    expect(result).toMatchObject({
      code: 'the-code',
      redirectUri: options.redirectUri,
    });
    expect(result.codeVerifier).toBeUndefined();
    expect(result.accessToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to exchange the code on the device', async () => {
    await expect(
      twitchLogin.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(native.openAuthSession).not.toHaveBeenCalled();
  });

  it('maps "The user denied you access" to CANCELLED', async () => {
    approveWith(native, {
      error: 'access_denied',
      error_description: 'The user denied you access',
    });
    await expect(twitchLogin.signIn(options)).rejects.toMatchObject({
      code: 'CANCELLED',
      providerError: 'access_denied',
    });
  });

  it('lets a sign-in add parameters without losing the claims', async () => {
    approveWith(native);
    await twitchLogin.signIn({
      ...options,
      extraParams: { force_verify: 'true' },
    });
    expect(sent().params.force_verify).toBe('true');
    expect(sent().params.claims).toContain('preferred_username');
  });

  it('accepts overrides', async () => {
    approveWith(native);
    await createTwitchLogin({
      authorizationEndpoint: 'http://localhost:4000/authorize',
      extraAuthParams: { claims: twitchClaims(['picture']) },
    }).signIn(options);
    expect(sent().endpoint).toBe('http://localhost:4000/authorize');
    expect(sent().params.claims).toBe(
      '{"id_token":{"picture":null},"userinfo":{"picture":null}}'
    );
  });
});

describe('mapTwitchProfile', () => {
  it('maps userinfo, and a null email when it is not verified', () => {
    expect(
      mapTwitchProfile({
        sub: '713936733',
        preferred_username: 'Ada',
        picture: 'https://static-cdn.jtvnw.net/x.png',
        email: 'ada@example.com',
        email_verified: true,
      })
    ).toEqual({
      id: '713936733',
      username: 'Ada',
      picture: 'https://static-cdn.jtvnw.net/x.png',
      email: 'ada@example.com',
      emailVerified: true,
    });
    expect(
      mapTwitchProfile({ sub: '1', email: null, email_verified: false })
    ).toMatchObject({ id: '1', email: undefined, emailVerified: false });
  });
});
