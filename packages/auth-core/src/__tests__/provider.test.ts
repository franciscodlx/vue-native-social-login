import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  jsonResponse,
  makeJwt,
  createNativeMock,
  type NativeMock,
} from '../__fixtures__/helpers';

import { setNativeForTesting } from '../native';
import { createProviderLogin } from '../provider';
import { decodeParams } from '../url';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock =
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const login = createProviderLogin({
  id: 'mock',
  authorizationEndpoint: 'https://idp.test/authorize',
  tokenEndpoint: 'https://idp.test/token',
  userInfoEndpoint: 'https://idp.test/userinfo',
  revocationEndpoint: 'https://idp.test/revoke',
  issuer: 'https://idp.test',
  defaultScopes: ['openid', 'email'],
  useNonce: true,
  mapProfile: (raw) => ({ id: String(raw.sub), email: String(raw.email) }),
});

const options = { clientId: 'client-1', redirectUri: 'myapp://callback' };

beforeEach(() => {
  native.openAuthSession.mockReset();
  fetchMock.mockReset();
});

describe('createProviderLogin', () => {
  it('returns only the code by default, for a backend exchange', async () => {
    approveWith(native);
    const result = await login.signIn(options);
    expect(result).toMatchObject({
      code: 'the-code',
      redirectUri: options.redirectUri,
    });
    expect(result.codeVerifier).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges on-device, validates the id_token and maps the profile', async () => {
    approveWith(native);
    fetchMock.mockImplementation(async (url, init) => {
      if (url === 'https://idp.test/token') {
        const nonce = /[?&]nonce=([^&]+)/.exec(
          native.openAuthSession.mock.calls[0]![0]
        )![1];
        expect(decodeParams(init.body as string).code_verifier).toBeTruthy();
        return jsonResponse({
          access_token: 'at',
          id_token: makeJwt({
            iss: 'https://idp.test',
            aud: 'client-1',
            sub: 'u1',
            nonce,
          }),
        });
      }
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer at'
      );
      return jsonResponse({ sub: 'u1', email: 'u1@idp.test' });
    });

    const result = await login.signIn({ ...options, exchangeCode: true });
    expect(result.accessToken).toBe('at');
    expect(result.idTokenClaims?.sub).toBe('u1');
    expect(result.profile).toEqual({ id: 'u1', email: 'u1@idp.test' });
  });

  it('fails when the id_token carries another nonce', async () => {
    approveWith(native);
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: 'at',
        id_token: makeJwt({
          iss: 'https://idp.test',
          aud: 'client-1',
          nonce: 'replayed',
        }),
      })
    );
    await expect(
      login.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('nonce mismatch'),
    });
  });

  it('refuses an on-device exchange for providers without a token endpoint', async () => {
    const backendOnly = createProviderLogin({
      id: 'secret-only',
      authorizationEndpoint: 'https://idp.test/authorize',
      defaultScopes: [],
    });
    await expect(
      backendOnly.signIn({ ...options, exchangeCode: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(native.openAuthSession).not.toHaveBeenCalled();
  });

  it('revokes the token on signOut when it can', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await login.signOut({ clientId: 'client-1', token: 'at' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://idp.test/revoke');

    fetchMock.mockReset();
    await login.signOut();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes availability from the native module', async () => {
    await expect(login.isAvailable()).resolves.toBe(true);
  });
});
