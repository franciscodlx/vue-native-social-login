import { createHash } from 'node:crypto';
import { vi } from 'vitest';

/** In-memory stand-in for the native layer, with real SHA-256. */
export function createNativeMock() {
  let counter = 0;
  return {
    isAvailable: vi.fn(async () => true),
    randomBase64Url: vi.fn(
      async (byteLength: number) => `rnd${byteLength}-${++counter}`
    ),
    sha256Base64Url: vi.fn(async (input: string) =>
      createHash('sha256').update(input).digest('base64url')
    ),
    openAuthSession:
      vi.fn<
        (
          url: string,
          redirectUri: string,
          prefersEphemeralSession: boolean
        ) => Promise<string>
      >(),
    cancelAuthSession: vi.fn(async () => {}),
  };
}

export type NativeMock = ReturnType<typeof createNativeMock>;

/** Makes the fake browser approve: redirects back echoing `state`. */
export function approveWith(
  native: NativeMock,
  params: Record<string, string> = { code: 'the-code' }
) {
  native.openAuthSession.mockImplementation(async (url, redirectUri) => {
    const state = /[?&]state=([^&]+)/.exec(url)?.[1] ?? '';
    const query = Object.entries({ ...params, state })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return `${redirectUri}?${query}`;
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

export function makeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}
