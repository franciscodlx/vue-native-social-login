import { platformNative } from './platform';

/**
 * What the TypeScript core needs from the platform. Kept as a narrow
 * interface so the flow (authorize, provider) is identical in every
 * framework of the family and easy to fake in tests.
 */
export interface AuthNative {
  isAvailable(): Promise<boolean>;
  randomBase64Url(byteLength: number): Promise<string>;
  sha256Base64Url(input: string): Promise<string>;
  openAuthSession(
    url: string,
    redirectUri: string,
    prefersEphemeralSession: boolean
  ): Promise<string>;
  cancelAuthSession(): Promise<void>;
}

let current: AuthNative = platformNative;

export function getNative(): AuthNative {
  return current;
}

/** Replaces the platform layer. For tests only. */
export function setNativeForTesting(native: AuthNative | null): void {
  current = native ?? platformNative;
}

/** Whether a system browser auth session can be presented on this device. */
export async function isAvailable(): Promise<boolean> {
  try {
    return await current.isAvailable();
  } catch {
    return false;
  }
}
