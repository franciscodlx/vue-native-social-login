import { getNative } from './native';

export interface PkcePair {
  /** Keep it in memory and send it with the code to the token endpoint. */
  codeVerifier: string;
  /** `BASE64URL(SHA256(codeVerifier))`, sent in the authorization request. */
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/** URL-safe random string backed by the platform CSPRNG. */
export function randomString(byteLength = 32): Promise<string> {
  return getNative().randomBase64Url(byteLength);
}

/** RFC 7636 verifier/challenge pair (S256). 32 random bytes → 43 chars. */
export async function createPkcePair(): Promise<PkcePair> {
  const native = getNative();
  const codeVerifier = await native.randomBase64Url(32);
  return {
    codeVerifier,
    codeChallenge: await native.sha256Base64Url(codeVerifier),
    codeChallengeMethod: 'S256',
  };
}
