import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../__fixtures__/helpers';

import { setNativeForTesting } from '../native';
import { authorize } from '../authorize';
import { decodeParams } from '../url';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);

const request = {
  authorizationEndpoint: 'https://idp.test/authorize',
  clientId: 'client-1',
  redirectUri: 'myapp://callback',
  scopes: ['openid', 'profile'],
};

function sentParams() {
  const url = native.openAuthSession.mock.calls[0]![0];
  return decodeParams(url.slice(url.indexOf('?') + 1));
}

beforeEach(() => {
  native.openAuthSession.mockReset();
});

describe('authorize', () => {
  it('sends a PKCE S256 challenge, state and scopes, and returns the code', async () => {
    approveWith(native);
    const result = await authorize(request);
    const sent = sentParams();

    expect(sent).toMatchObject({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'myapp://callback',
      scope: 'openid profile',
      code_challenge_method: 'S256',
    });
    expect(sent.code_challenge).toBe(
      createHash('sha256').update(result.codeVerifier!).digest('base64url')
    );
    expect(sent.state).toBe(result.state);
    expect(sent.nonce).toBeUndefined();
    expect(result.code).toBe('the-code');
    expect(native.openAuthSession).toHaveBeenCalledWith(
      expect.any(String),
      'myapp://callback',
      false
    );
  });

  it('never puts the verifier in the URL', async () => {
    approveWith(native);
    const result = await authorize(request);
    expect(native.openAuthSession.mock.calls[0]![0]).not.toContain(
      result.codeVerifier!
    );
  });

  it('adds a nonce when asked and skips PKCE when disabled', async () => {
    approveWith(native);
    const result = await authorize({
      ...request,
      useNonce: true,
      usePKCE: false,
      scopeSeparator: ',',
      extraParams: { prompt: 'login' },
    });
    const sent = sentParams();
    expect(sent.nonce).toBe(result.nonce);
    expect(sent.code_challenge).toBeUndefined();
    expect(result.codeVerifier).toBeUndefined();
    expect(sent.scope).toBe('openid,profile');
    expect(sent.prompt).toBe('login');
  });

  it('rejects a response with a different state', async () => {
    native.openAuthSession.mockResolvedValue(
      'myapp://callback?code=stolen&state=attacker'
    );
    await expect(authorize(request)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('State mismatch'),
    });
  });

  it('rejects a redirect to another URI', async () => {
    native.openAuthSession.mockResolvedValue('other://callback?code=x');
    await expect(authorize(request)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('maps access_denied to CANCELLED and other provider errors to PROVIDER_ERROR', async () => {
    approveWith(native, { error: 'access_denied' });
    await expect(authorize(request)).rejects.toMatchObject({
      code: 'CANCELLED',
      providerError: 'access_denied',
    });

    approveWith(native, {
      error: 'invalid_scope',
      error_description: 'Scope not allowed',
    });
    await expect(authorize(request)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'Scope not allowed',
      providerError: 'invalid_scope',
    });
  });

  it('passes through native rejections with their code', async () => {
    native.openAuthSession.mockRejectedValue(
      Object.assign(new Error('User cancelled'), { code: 'CANCELLED' })
    );
    await expect(authorize(request)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'CANCELLED',
    });
  });

  it('validates the configuration before opening the browser', async () => {
    await expect(authorize({ ...request, clientId: '' })).rejects.toMatchObject(
      { code: 'INVALID_CONFIG' }
    );
    await expect(
      authorize({ ...request, authorizationEndpoint: 'http://idp.test/a' })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(
      authorize({
        ...request,
        authorizationEndpoint: 'http://localhost.evil.io/a',
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(
      authorize({ ...request, redirectUri: 'callback' })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(native.openAuthSession).not.toHaveBeenCalled();
  });

  it('waits on callbackUri while sending redirectUri to the provider', async () => {
    approveWith(native);
    const result = await authorize({
      ...request,
      redirectUri: 'https://api.test/oauth/callback',
      callbackUri: 'myapp://callback',
    });
    expect(sentParams().redirect_uri).toBe('https://api.test/oauth/callback');
    expect(native.openAuthSession.mock.calls[0]![1]).toBe('myapp://callback');
    // The backend exchanges the code with the URI the provider saw.
    expect(result.redirectUri).toBe('https://api.test/oauth/callback');
  });

  it('treats provider-specific cancel errors as CANCELLED', async () => {
    approveWith(native, { error: 'user_cancelled_login' });
    await expect(authorize(request)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    approveWith(native, { error: 'user_cancelled_login' });
    await expect(
      authorize({ ...request, cancelErrors: ['user_cancelled_login'] })
    ).rejects.toMatchObject({
      code: 'CANCELLED',
      providerError: 'user_cancelled_login',
    });
  });

  it('allows plain http only for a local test server', async () => {
    approveWith(native);
    await expect(
      authorize({
        ...request,
        authorizationEndpoint: 'http://10.0.2.2:4000/authorize',
      })
    ).resolves.toMatchObject({ code: 'the-code' });
  });

  it('refuses a second sign-in while one is open, then recovers', async () => {
    let finish!: (url: string) => void;
    native.openAuthSession.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finish = resolve))
    );
    const first = authorize(request);
    await expect(authorize(request)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    finish('myapp://callback?error=access_denied');
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });

    approveWith(native);
    await expect(authorize(request)).resolves.toMatchObject({
      code: 'the-code',
    });
  });
});
