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
  redirectUri = `${backendUrl}/auth/linkedin/callback`;
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
    scope: 'openid profile email',
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
  fetch(`${backendUrl}/auth/linkedin/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('bounces the provider response to the app scheme', async () => {
  const appUrl = await browserSignIn();
  assert.equal(appUrl.protocol, 'linkedinexample:');
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
  const res = await postExchange({ code, redirectUri });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.idTokenVerified, true);
  assert.deepEqual(body.profile, {
    id: 'user-123',
    name: 'Ada Lovelace',
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

  assert.equal((await postExchange({ code, redirectUri })).status, 200);
  const replay = await postExchange({ code, redirectUri });
  assert.equal(replay.status, 502);
  assert.equal((await replay.json()).error, 'invalid_grant');
});

test('requires credentials and an https public URL for the real provider', () => {
  assert.throws(
    () => loadConfig({ PROVIDER: 'linkedin' }),
    /LINKEDIN_CLIENT_ID/
  );
  assert.throws(
    () =>
      loadConfig({
        PROVIDER: 'linkedin',
        LINKEDIN_CLIENT_ID: 'id',
        LINKEDIN_CLIENT_SECRET: 'secret',
        PUBLIC_URL: 'http://insecure.test',
      }),
    /https/
  );
});
