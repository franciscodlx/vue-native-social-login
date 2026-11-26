import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

before(async () => {
  idp = createMockIdp();
  idpUrl = `http://localhost:${await listen(idp)}`;

  const config = loadConfig({ PORT: '0' });
  config.provider = {
    tokenEndpoint: `${idpUrl}/token`,
    userInfoEndpoint: `${idpUrl}/users/me`,
  };
  backend = createBackend(config);
  backendUrl = `http://localhost:${await listen(backend)}`;
  redirectUri = `${backendUrl}/auth/mercadolibre/callback`;
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
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
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
  fetch(`${backendUrl}/auth/mercadolibre/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the callback forwards code and state to the app scheme', async () => {
  const app = await browserSignIn();
  assert.equal(app.protocol, 'meliexample:');
  assert.equal(app.searchParams.get('state'), 'state-1');
  assert.ok(app.searchParams.get('code'));
});

test('a denial is forwarded too', async () => {
  const app = await browserSignIn({ decision: 'deny' });
  assert.equal(app.searchParams.get('error'), 'access_denied');
});

test('exchange returns the profile and keeps the tokens on the server', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const res = await exchange({ code, redirectUri, codeVerifier: verifier });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.profile, {
    id: '202593498',
    nickname: 'ADA.LOVELACE',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    countryId: 'MX',
    siteId: 'MLM',
    picture: 'https://example.com/ada.jpg',
  });
  assert.equal(body.hasRefreshToken, true);
  assert.equal(JSON.stringify(body).includes('at-'), false);
});

test('a wrong or missing verifier, or a foreign redirectUri, is rejected', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const missing = await exchange({ code, redirectUri });
  assert.equal(missing.status, 400);
  const foreign = await exchange({
    code,
    redirectUri: 'https://evil.test/cb',
    codeVerifier: verifier,
  });
  assert.equal(foreign.status, 400);
  const wrong = await exchange({
    code,
    redirectUri,
    codeVerifier: 'x'.repeat(43),
  });
  assert.equal(wrong.status, 502);
  assert.equal((await wrong.json()).error, 'invalid_grant');
});

test('real provider needs an https PUBLIC_URL and credentials', () => {
  assert.throws(() => loadConfig({ PROVIDER: 'mercadolibre' }), /CLIENT_ID/);
  assert.throws(
    () =>
      loadConfig({
        PROVIDER: 'mercadolibre',
        MERCADOLIBRE_CLIENT_ID: 'a',
        MERCADOLIBRE_CLIENT_SECRET: 'b',
        PUBLIC_URL: 'http://x.test',
      }),
    /https/
  );
});
