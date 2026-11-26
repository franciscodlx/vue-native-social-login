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
  idp = createMockIdp();
  idpUrl = `http://localhost:${await listen(idp)}`;

  const config = loadConfig({ PORT: '0' });
  config.provider = {
    tokenEndpoint: `${idpUrl}/token`,
    userInfoEndpoint: `${idpUrl}/v2/user/info/`,
  };
  backend = createBackend(config);
  backendUrl = `http://localhost:${await listen(backend)}`;
  redirectUri = `${backendUrl}/auth/tiktok/callback`;
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
    client_key: 'confidential-app',
    redirect_uri: redirectUri,
    scope: 'user.info.basic',
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
  return new URL(bounce.headers.get('location'));
}

const exchange = (body) =>
  fetch(`${backendUrl}/auth/tiktok/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the callback forwards code, granted scopes and state to the app scheme', async () => {
  const app = await browserSignIn();
  assert.equal(app.protocol, 'tiktokexample:');
  assert.equal(app.searchParams.get('state'), 'state-1');
  assert.equal(app.searchParams.get('scopes'), 'user.info.basic');
  assert.ok(app.searchParams.get('code'));
});

test('a denial is forwarded too', async () => {
  const app = await browserSignIn({ decision: 'deny' });
  assert.equal(app.searchParams.get('error'), 'access_denied');
});

test('exchange sends client_key + secret and returns the profile, not the tokens', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const res = await exchange({ code, redirectUri });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.profile, {
    id: '723f24d7-e717-40f8-a2b6-cb8464cd23b4',
    unionId: 'c9c60f44-a68e-4f5d-84dd-ce22faeb0ba1',
    displayName: 'Ada Lovelace',
    picture: 'https://example.com/ada-tiktok.jpeg',
  });
  assert.equal(body.hasRefreshToken, true);
  assert.equal(JSON.stringify(body).includes('at-'), false);
});

test('a foreign redirectUri and a reused code are rejected', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const foreign = await exchange({ code, redirectUri: 'https://evil.test/cb' });
  assert.equal(foreign.status, 400);
  assert.equal((await exchange({ code, redirectUri })).status, 200);
  const replay = await exchange({ code, redirectUri });
  assert.equal(replay.status, 502);
  assert.equal((await replay.json()).error, 'invalid_grant');
});

test('real provider needs an https PUBLIC_URL and credentials', () => {
  assert.throws(() => loadConfig({ PROVIDER: 'tiktok' }), /TIKTOK_CLIENT_KEY/);
  assert.throws(
    () =>
      loadConfig({
        PROVIDER: 'tiktok',
        TIKTOK_CLIENT_KEY: 'a',
        TIKTOK_CLIENT_SECRET: 'b',
        PUBLIC_URL: 'http://x.test',
      }),
    /https/
  );
});
