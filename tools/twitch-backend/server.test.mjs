import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createMockIdp } from '../mock-idp/server.mjs';
import { createBackend, loadConfig } from './server.mjs';

let idp;
let backend;
let idpUrl;
let backendUrl;
let redirectUri;

const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, () => resolve(server.address().port))
  );

before(async () => {
  // The issuer is only known once the port is, so reserve it first.
  const probe = createMockIdp();
  const idpPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  idpUrl = `http://localhost:${idpPort}`;
  idp = createMockIdp({ issuer: idpUrl });
  await new Promise((resolve) => idp.listen(idpPort, resolve));

  const config = loadConfig({ PORT: '0' });
  config.provider = {
    issuer: idpUrl,
    tokenEndpoint: `${idpUrl}/token`,
    userInfoEndpoint: `${idpUrl}/userinfo`,
    jwksUri: `${idpUrl}/jwks`,
  };
  backend = createBackend(config);
  backendUrl = `http://localhost:${await listen(backend)}`;
  redirectUri = `${backendUrl}/auth/twitch/callback`;
  config.redirectUris = [redirectUri];
});

after(() => {
  idp.close();
  backend.close();
});

/** What the system browser does: authorize, then follow the bounce. */
async function browserSignIn(extra = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'confidential-app',
    redirect_uri: redirectUri,
    scope: 'openid user:read:email',
    nonce: 'nonce-1',
    claims: JSON.stringify({
      id_token: { email: null, email_verified: null },
      userinfo: {
        email: null,
        email_verified: null,
        picture: null,
        preferred_username: null,
      },
    }),
    state: 'state-1',
    decision: 'approve',
    ...extra,
  });
  const authorize = await fetch(`${idpUrl}/authorize?${query}`, {
    redirect: 'manual',
  });
  const bounce = await fetch(authorize.headers.get('location'), {
    redirect: 'manual',
  });
  assert.equal(bounce.status, 302);
  return new URL(bounce.headers.get('location'));
}

const postExchange = (body) =>
  fetch(`${backendUrl}/auth/twitch/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('bounces the provider response to the app scheme', async () => {
  const appUrl = await browserSignIn();
  assert.equal(appUrl.protocol, 'twitchexample:');
  assert.equal(appUrl.host, 'callback');
  assert.equal(appUrl.searchParams.get('state'), 'state-1');
  assert.ok(appUrl.searchParams.get('code'));
});

test('bounces errors too, so the app can report a cancellation', async () => {
  const appUrl = await browserSignIn({ decision: 'deny' });
  assert.equal(appUrl.searchParams.get('error'), 'access_denied');
  assert.equal(appUrl.searchParams.get('state'), 'state-1');
});

test('exchanges the code with the secret, verifies the id_token and returns the profile', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const res = await postExchange({ code, redirectUri, nonce: 'nonce-1' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idTokenVerified, true);
  assert.deepEqual(body.profile, {
    id: 'user-123',
    username: 'AdaLovelace',
    picture: 'https://example.com/ada-twitch.png',
    email: 'ada@example.com',
    emailVerified: true,
  });
  assert.equal(body.access_token, undefined);
});

test('rejects a redirectUri it does not own and a reused code', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const foreign = await postExchange({
    code,
    redirectUri: 'https://evil.test/cb',
  });
  assert.equal(foreign.status, 400);

  assert.equal(
    (await postExchange({ code, redirectUri, nonce: 'nonce-1' })).status,
    200
  );
  const replay = await postExchange({ code, redirectUri, nonce: 'nonce-1' });
  assert.equal(replay.status, 502);
  assert.equal((await replay.json()).error, 'invalid_grant');
});

test('rejects an id_token issued for another sign-in (nonce mismatch)', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const missing = await postExchange({ code, redirectUri });
  assert.equal(missing.status, 400);
  const other = await postExchange({ code, redirectUri, nonce: 'nonce-2' });
  assert.equal(other.status, 502);
  assert.equal((await other.json()).error, 'invalid_id_token');
});

test('requires credentials and an https public URL for the real provider', () => {
  assert.throws(() => loadConfig({ PROVIDER: 'twitch' }), /TWITCH_CLIENT_ID/);
  assert.throws(
    () =>
      loadConfig({
        PROVIDER: 'twitch',
        TWITCH_CLIENT_ID: 'id',
        TWITCH_CLIENT_SECRET: 'secret',
        PUBLIC_URL: 'http://insecure.test',
      }),
    /https/
  );
});
