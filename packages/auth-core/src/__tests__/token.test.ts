import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, makeJwt } from '../__fixtures__/helpers';
import { decodeIdToken, validateIdTokenClaims } from '../idToken';
import {
  REQUEST_TIMEOUT_MS,
  exchangeCode,
  fetchUserInfo,
  refreshAccessToken,
} from '../token';
import { decodeParams } from '../url';

const fetchMock =
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
(globalThis as { fetch: unknown }).fetch = fetchMock;

beforeEach(() => fetchMock.mockReset());

describe('exchangeCode', () => {
  it('posts the code with the verifier and no secret', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: '3600',
        token_type: 'bearer',
      })
    );
    const tokens = await exchangeCode({
      tokenEndpoint: 'https://idp.test/token',
      clientId: 'client-1',
      code: 'c',
      redirectUri: 'myapp://callback',
      codeVerifier: 'verifier',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://idp.test/token');
    expect(init.method).toBe('POST');
    const form = decodeParams(init.body as string);
    expect(form).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: 'myapp://callback',
      client_id: 'client-1',
      code_verifier: 'verifier',
    });
    expect(form.client_secret).toBeUndefined();
    expect(tokens).toMatchObject({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
    });
  });

  it('reports provider errors with their description and status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'invalid_grant', error_description: 'Code expired' },
        400
      )
    );
    await expect(
      exchangeCode({
        tokenEndpoint: 'https://idp.test/token',
        clientId: 'c',
        code: 'c',
        redirectUri: 'r://x',
      })
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'Code expired',
      providerError: 'invalid_grant',
      status: 400,
    });
  });

  it('reads problem details (title, detail, reason) from REST APIs', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          title: 'Client Forbidden',
          detail:
            'This request must be made using an approved developer account.',
          reason: 'client-not-enrolled',
        },
        403
      )
    );
    await expect(
      fetchUserInfo('https://api.test/2/users/me', 'at')
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'This request must be made using an approved developer account.',
      providerError: 'client-not-enrolled',
      status: 403,
    });
  });

  it('reports NETWORK when the request cannot be made', async () => {
    // Once: a fetch mock that keeps throwing also breaks vitest's own fetches.
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Network request failed');
    });
    const error = await refreshAccessToken({
      tokenEndpoint: 'https://idp.test/token',
      clientId: 'c',
      refreshToken: 'rt',
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NETWORK' });
  });

  it('reports NETWORK when the provider does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
      const result = refreshAccessToken({
        tokenEndpoint: 'https://idp.test/token',
        clientId: 'c',
        refreshToken: 'rt',
      }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(await result).toMatchObject({
        code: 'NETWORK',
        message: expect.stringContaining('did not answer'),
      });
      expect(fetchMock.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('id_token', () => {
  const claims = {
    iss: 'https://idp.test',
    aud: 'client-1',
    sub: 'u1',
    nonce: 'n1',
    exp: 2_000_000_000,
    name: 'José Ñandú 🎉',
  };

  it('decodes the payload, including non-ASCII text', () => {
    expect(decodeIdToken(makeJwt(claims))).toEqual(claims);
  });

  it('rejects malformed tokens', () => {
    expect(() => decodeIdToken('not-a-jwt')).toThrow('Malformed id_token');
    expect(() => decodeIdToken('a.!!!.c')).toThrow('Malformed id_token');
  });

  it('checks issuer, audience, nonce and expiry', () => {
    const expected = {
      issuer: 'https://idp.test',
      audience: 'client-1',
      nonce: 'n1',
      now: 1_900_000_000_000,
    };
    expect(() => validateIdTokenClaims(claims, expected)).not.toThrow();
    expect(() =>
      validateIdTokenClaims(claims, { ...expected, nonce: 'other' })
    ).toThrow('nonce mismatch');
    expect(() =>
      validateIdTokenClaims(claims, { ...expected, audience: 'other' })
    ).toThrow('unexpected audience');
    expect(() =>
      validateIdTokenClaims(claims, { ...expected, issuer: 'https://evil' })
    ).toThrow('unexpected issuer');
    expect(() =>
      validateIdTokenClaims(claims, { ...expected, now: 2_100_000_000_000 })
    ).toThrow('token expired');
    expect(() =>
      validateIdTokenClaims({ ...claims, aud: ['x', 'client-1'] }, expected)
    ).not.toThrow();
  });
});
