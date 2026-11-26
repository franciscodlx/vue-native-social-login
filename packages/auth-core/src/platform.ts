import { NativeBridge } from '@thelacanians/vue-native-runtime';
import { AuthError, type AuthErrorCode } from './errors';
import type { AuthNative } from './native';
import { base64Url, sha256Base64Url } from './sha256';

/** Name of the module generated from native/SocialLoginAuthSession.vue. */
export const NATIVE_MODULE = 'SocialLoginAuthSession';

/**
 * How long the browser may stay open. Not 0 ("no timeout"): with 0 the
 * runtime (0.23.x) calls clearTimeout(undefined) when the answer arrives,
 * which throws on Android and the answer is lost.
 */
export const AUTH_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

const SETUP_HINT =
  'Run `npx vue-native-social-login setup` and rebuild the app: it adds the native module to app/native/.';

const CODES: readonly AuthErrorCode[] = [
  'CANCELLED',
  'NETWORK',
  'INVALID_CONFIG',
  'PROVIDER_ERROR',
  'NOT_SUPPORTED',
];

/**
 * The native module answers errors as "CODE: message". Anything else comes
 * from the bridge itself: a missing module or a timeout.
 */
export function toNativeAuthError(error: unknown): AuthError {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z_]+): ([\s\S]*)$/.exec(message);
  const code = match?.[1] as AuthErrorCode | undefined;
  if (code && CODES.includes(code)) {
    return new AuthError(code, match![2] ?? '', { cause: error });
  }
  if (/not found|No module registered/i.test(message)) {
    return new AuthError(
      'NOT_SUPPORTED',
      `The ${NATIVE_MODULE} native module is not in this build. ${SETUP_HINT}`,
      { cause: error }
    );
  }
  if (/timed out/i.test(message)) {
    return new AuthError('CANCELLED', 'The sign-in timed out', {
      cause: error,
    });
  }
  return new AuthError('PROVIDER_ERROR', message, { cause: error });
}

async function call<T>(
  method: string,
  args: unknown[] = [],
  timeoutMs?: number
): Promise<T> {
  try {
    return await NativeBridge.invokeNativeModule<T>(
      NATIVE_MODULE,
      method,
      args,
      timeoutMs
    );
  } catch (error) {
    throw toNativeAuthError(error);
  }
}

function randomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  // The runtime polyfills crypto.getRandomValues on top of the platform
  // CSPRNG (SecRandomCopyBytes / SecureRandom); crypto.subtle is absent,
  // hence the TypeScript SHA-256.
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new AuthError(
      'NOT_SUPPORTED',
      'crypto.getRandomValues is not available in this runtime'
    );
  }
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export const platformNative: AuthNative = {
  async isAvailable() {
    return (await call<boolean>('isAvailable', [], 5000)) === true;
  },
  async randomBase64Url(byteLength) {
    return base64Url(randomBytes(byteLength));
  },
  async sha256Base64Url(input) {
    return sha256Base64Url(input);
  },
  async openAuthSession(url, redirectUri, prefersEphemeralSession) {
    const redirect = await call<string>(
      'open',
      [url, redirectUri, prefersEphemeralSession],
      AUTH_SESSION_TIMEOUT_MS
    );
    if (typeof redirect !== 'string' || redirect === '') {
      throw new AuthError(
        'PROVIDER_ERROR',
        'The browser closed without a redirect URL'
      );
    }
    return redirect;
  },
  async cancelAuthSession() {
    await call<void>('cancel', [], 5000).catch(() => undefined);
  },
};
