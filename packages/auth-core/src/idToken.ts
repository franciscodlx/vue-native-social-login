import { AuthError } from './errors';

export type IdTokenClaims = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nonce?: string;
};

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlToBytes(input: string): number[] {
  const clean = input
    .replace(/[=]+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) {
      throw new AuthError('PROVIDER_ERROR', 'Malformed id_token');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

function utf8Decode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i++] as number;
    let codePoint: number;
    if (b0 < 0x80) {
      codePoint = b0;
    } else if (b0 < 0xe0) {
      codePoint = ((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else if (b0 < 0xf0) {
      codePoint =
        ((b0 & 0x0f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    } else {
      codePoint =
        ((b0 & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    }
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

/**
 * Decodes the payload of a JWT **without verifying its signature**.
 * Use the claims for display; verify the signature on your backend before
 * trusting them.
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new AuthError('PROVIDER_ERROR', 'Malformed id_token');
  }
  try {
    const claims: unknown = JSON.parse(utf8Decode(base64UrlToBytes(parts[1])));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      throw new Error('not an object');
    }
    return claims as IdTokenClaims;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('PROVIDER_ERROR', 'Malformed id_token', {
      cause: error,
    });
  }
}

export interface IdTokenExpectations {
  /** Expected `iss`. Skipped when undefined. */
  issuer?: string;
  /** Expected `aud` (your client id). Skipped when undefined. */
  audience?: string;
  /** Nonce sent in the authorization request. Skipped when undefined. */
  nonce?: string;
  /** Allowed clock skew in seconds. Defaults to 60. */
  clockToleranceSeconds?: number;
  /** Current time in ms, for tests. */
  now?: number;
}

/**
 * Checks the claims an app can check on-device: `iss`, `aud`, `exp` and
 * `nonce` (OpenID Connect Core §3.1.3.7). The signature is NOT verified here.
 */
export function validateIdTokenClaims(
  claims: IdTokenClaims,
  expected: IdTokenExpectations = {}
): void {
  const fail = (reason: string): never => {
    throw new AuthError('PROVIDER_ERROR', `Invalid id_token: ${reason}`);
  };
  if (expected.issuer !== undefined && claims.iss !== expected.issuer) {
    fail('unexpected issuer');
  }
  if (expected.audience !== undefined) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(expected.audience)) {
      fail('unexpected audience');
    }
  }
  if (expected.nonce !== undefined && claims.nonce !== expected.nonce) {
    fail('nonce mismatch');
  }
  if (typeof claims.exp === 'number') {
    const nowSeconds = (expected.now ?? Date.now()) / 1000;
    if (nowSeconds > claims.exp + (expected.clockToleranceSeconds ?? 60)) {
      fail('token expired');
    }
  }
}
