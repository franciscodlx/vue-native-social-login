import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64Url, sha256Base64Url } from '../sha256';

const reference = (input: string) =>
  createHash('sha256').update(input, 'utf8').digest('base64url');

describe('sha256Base64Url', () => {
  it.each([
    '',
    'abc',
    'dBjftJeZ4CVP-mJ92K1qmHbMqrjS2kFIbvSRMz8xg5I',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(1000),
    'ñandú 🦄 café',
  ])('matches node:crypto for %j', (input) => {
    expect(sha256Base64Url(input)).toBe(reference(input));
  });
});

describe('base64Url', () => {
  it.each([0, 1, 2, 3, 16, 32])('encodes %i bytes like Buffer', (length) => {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
    expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
  });
});
