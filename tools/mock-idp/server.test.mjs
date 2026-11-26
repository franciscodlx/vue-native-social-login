import assert from 'node:assert/strict';
import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createMockIdp } from './server.mjs';

let server;
let base;

before(async () => {
  server = createMockIdp();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function getCode(extra = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'app',
    redirect_uri: 'myapp://callback',
    state: 's1',
    nonce: 'n1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    decision: 'approve',
    ...extra,
  });
  const res = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
  return new URL(res.headers.get('location'));
}

const exchange = (form) =>
  fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams(form) });

test('full code + PKCE flow returns tokens and a signed id_token', async () => {
  const location = await getCode();
  assert.equal(location.searchParams.get('state'), 's1');

  const res = await exchange({
    grant_type: 'authorization_code',
    code: location.searchParams.get('code'),
    client_id: 'app',
    redirect_uri: 'myapp://callback',
    code_verifier: verifier,
  });
  assert.equal(res.status, 200);
  const tokens = await res.json();

  const [header, payload, signature] = tokens.id_token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.nonce, 'n1');
  assert.equal(claims.aud, 'app');

  const { keys } = await (await fetch(`${base}/jwks`)).json();
  const valid = createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(
      createPublicKey({ key: keys[0], format: 'jwk' }),
      signature,
      'base64url'
    );
  assert.equal(valid, true);

  const userinfo = await fetch(`${base}/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  assert.equal((await userinfo.json()).email, 'ada@example.com');
});

test('a wrong verifier is rejected and the code cannot be reused', async () => {
  const code = (await getCode()).searchParams.get('code');
  const form = {
    grant_type: 'authorization_code',
    code,
    client_id: 'app',
    redirect_uri: 'myapp://callback',
  };
  const bad = await exchange({ ...form, code_verifier: 'b'.repeat(43) });
  assert.equal(bad.status, 400);
  const replay = await exchange({ ...form, code_verifier: verifier });
  assert.equal(replay.status, 400);
});

test('requests without PKCE and denied requests redirect with an error', async () => {
  const noPkce = await getCode({ code_challenge_method: 'plain' });
  assert.equal(noPkce.searchParams.get('error'), 'invalid_request');
  const denied = await getCode({ decision: 'deny' });
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  assert.equal(denied.searchParams.get('state'), 's1');
});

test('a confidential client needs its secret and may skip PKCE', async () => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'confidential-app',
    redirect_uri: 'https://api.test/cb',
    state: 's2',
    decision: 'approve',
  });
  const res = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const form = {
    grant_type: 'authorization_code',
    code,
    client_id: 'confidential-app',
    redirect_uri: 'https://api.test/cb',
  };
  const noSecret = await exchange(form);
  assert.equal(noSecret.status, 401);
  assert.equal((await noSecret.json()).error, 'invalid_client');

  const ok = await exchange({ ...form, client_secret: 'mock-secret' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).id_token);
});

test('X-style client: users/me envelope, email and refresh token depend on scopes', async () => {
  const signIn = async (scope) => {
    const code = (await getCode({ scope })).searchParams.get('code');
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      client_id: 'app',
      redirect_uri: 'myapp://callback',
      code_verifier: verifier,
    });
    return res.json();
  };
  const me = async (accessToken) => {
    const res = await fetch(
      `${base}/2/users/me?user.fields=id,name,username,verified,confirmed_email`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return { status: res.status, body: await res.json() };
  };

  const basic = await signIn('users.read tweet.read');
  assert.equal(basic.refresh_token, undefined);
  assert.deepEqual((await me(basic.access_token)).body, {
    data: {
      id: '2244994945',
      name: 'Ada Lovelace',
      username: 'ada_lovelace',
      verified: false,
    },
  });

  const full = await signIn('users.read tweet.read users.email offline.access');
  assert.equal(
    (await me(full.access_token)).body.data.confirmed_email,
    'ada@example.com'
  );

  const refresh = () =>
    exchange({
      grant_type: 'refresh_token',
      refresh_token: full.refresh_token,
      client_id: 'app',
    });
  const refreshed = await (await refresh()).json();
  assert.ok(refreshed.access_token);
  assert.notEqual(refreshed.refresh_token, full.refresh_token);
  assert.equal((await refresh()).status, 400); // rotated: single use

  await fetch(`${base}/revoke`, {
    method: 'POST',
    body: new URLSearchParams({ token: basic.access_token, client_id: 'app' }),
  });
  assert.equal((await me(basic.access_token)).status, 401);
});
