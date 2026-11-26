import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge } from '@thelacanians/vue-native-runtime';
import {
  AUTH_SESSION_TIMEOUT_MS,
  NATIVE_MODULE,
  platformNative,
  toNativeAuthError,
} from '../platform';
import { sha256Base64Url } from '../sha256';

const invoke = vi.mocked(NativeBridge.invokeNativeModule);

beforeEach(() => {
  invoke.mockReset();
});

describe('toNativeAuthError', () => {
  it('reads the "CODE: message" answers of the native module', () => {
    const error = toNativeAuthError(
      new Error('CANCELLED: The user closed the browser')
    );
    expect(error.code).toBe('CANCELLED');
    expect(error.message).toBe('The user closed the browser');
  });

  it('points to the setup command when the module is missing', () => {
    for (const message of [
      "Module 'SocialLoginAuthSession' not found",
      'No module registered: SocialLoginAuthSession',
    ]) {
      const error = toNativeAuthError(new Error(message));
      expect(error.code).toBe('NOT_SUPPORTED');
      expect(error.message).toContain('vue-native-social-login setup');
    }
  });

  it('treats a bridge timeout as a cancellation', () => {
    expect(
      toNativeAuthError(new Error('Native module X.open timed out after 1ms'))
        .code
    ).toBe('CANCELLED');
  });

  it('keeps unknown codes as provider errors', () => {
    const error = toNativeAuthError(new Error('WHATEVER: boom'));
    expect(error.code).toBe('PROVIDER_ERROR');
  });
});

describe('platformNative', () => {
  it('opens the session with a finite timeout (0 breaks the runtime on Android)', async () => {
    invoke.mockResolvedValue('myapp://callback?code=c&state=s');

    await expect(
      platformNative.openAuthSession(
        'https://idp/authorize',
        'myapp://callback',
        true
      )
    ).resolves.toBe('myapp://callback?code=c&state=s');
    expect(invoke).toHaveBeenCalledWith(
      NATIVE_MODULE,
      'open',
      ['https://idp/authorize', 'myapp://callback', true],
      AUTH_SESSION_TIMEOUT_MS
    );
    expect(AUTH_SESSION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('normalizes native errors', async () => {
    invoke.mockRejectedValue(new Error('INVALID_CONFIG: busy'));
    await expect(
      platformNative.openAuthSession('u', 'myapp://callback', false)
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG', message: 'busy' });
  });

  it('rejects an empty redirect', async () => {
    invoke.mockResolvedValue('');
    await expect(
      platformNative.openAuthSession('u', 'myapp://callback', false)
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('is available only when the module answers true', async () => {
    invoke.mockResolvedValueOnce(true);
    await expect(platformNative.isAvailable()).resolves.toBe(true);
    invoke.mockRejectedValueOnce(new Error('No module registered: x'));
    await expect(platformNative.isAvailable()).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });

  it('never throws when cancelling', async () => {
    invoke.mockRejectedValue(new Error('No module registered: x'));
    await expect(platformNative.cancelAuthSession()).resolves.toBeUndefined();
  });

  it('builds random values and SHA-256 in TypeScript', async () => {
    const random = await platformNative.randomBase64Url(32);
    expect(random).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(platformNative.sha256Base64Url('abc')).resolves.toBe(
      sha256Base64Url('abc')
    );
  });
});
