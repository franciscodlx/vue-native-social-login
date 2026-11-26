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

const listen = (server, port = 0) =>
  new Promise((resolve) =>
    server.listen(port, () => resolve(server.address().port))
  );

const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

before(async () => {
  // The issuer is only known once the port is, so reserve it first.
  const probe = createMockIdp();
  const idpPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  idpUrl = `http://localhost:${idpPort}`;
  idp = createMockIdp({ issuer: idpUrl });
  await listen(idp, idpPort);

  const config = loadConfig({ PORT: '0' });
  config.provider = {
    issuer: idpUrl,
    tokenEndpoint: `${idpUrl}/token`,
    jwksUri: `${idpUrl}/jwks`,
  };
  backend = createBackend(config);
  backendUrl = `http://localhost:${await listen(backend)}`;
  redirectUri = `${backendUrl}/auth/telegram/callback`;
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
    scope: 'openid profile phone',
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
  fetch(`${backendUrl}/auth/telegram/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the callback forwards code, state and errors to the app scheme', async () => {
  const app = await browserSignIn();
  assert.equal(app.protocol, 'telegramexample:');
  assert.equal(app.searchParams.get('state'), 'state-1');
  assert.ok(app.searchParams.get('code'));
  const denied = await browserSignIn({ decision: 'deny' });
  assert.equal(denied.searchParams.get('error'), 'access_denied');
});

test('exchange authenticates with Basic, verifies the id_token and returns its claims as the profile', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  const res = await exchange({ code, redirectUri, codeVerifier: verifier });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idTokenVerified, true);
  assert.deepEqual(body.profile, {
    id: 'user-123',
    telegramId: '987654321',
    name: 'Ada Lovelace',
    username: 'ada_lovelace',
    picture: 'https://example.com/ada-telegram.jpg',
    phoneNumber: '+5215500000000',
  });
  assert.equal(JSON.stringify(body).includes('at-'), false);
});

test('without the phone scope there is no phone number', async () => {
  const code = (
    await browserSignIn({ scope: 'openid profile' })
  ).searchParams.get('code');
  const { profile } = await (
    await exchange({ code, redirectUri, codeVerifier: verifier })
  ).json();
  assert.equal(profile.phoneNumber, undefined);
  assert.equal(profile.name, 'Ada Lovelace');
});

test('a wrong or missing verifier, or a foreign redirectUri, is rejected', async () => {
  const code = (await browserSignIn()).searchParams.get('code');
  assert.equal((await exchange({ code, redirectUri })).status, 400);
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

test('real provider needs credentials and an https PUBLIC_URL', () => {
  assert.throws(
    () => loadConfig({ PROVIDER: 'telegram' }),
    /TELEGRAM_CLIENT_ID/
  );
  assert.throws(
    () =>
      loadConfig({
        PROVIDER: 'telegram',
        TELEGRAM_CLIENT_ID: 'a',
        TELEGRAM_CLIENT_SECRET: 'b',
        PUBLIC_URL: 'http://x.test',
      }),
    /https/
  );
});
