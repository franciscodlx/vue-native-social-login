import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createMockIdp } from '../mock-idp/server.mjs';
import { createBackend, loadConfig } from './server.mjs';

let idp;
let backend;
let idpUrl;
let backendUrl;

const listen = (server, port = 0) =>
  new Promise((resolve) =>
    server.listen(port, () => resolve(server.address().port))
  );

const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirectUri = (name) => `${backendUrl}/auth/${name}/callback`;

before(async () => {
  // The issuer is only known once the port is, so reserve it first.
  const probe = createMockIdp();
  const idpPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  idpUrl = `http://localhost:${idpPort}`;
  idp = createMockIdp({ issuer: idpUrl });
  await listen(idp, idpPort);

  const config = loadConfig({ PORT: '0' });
  backend = createBackend(config);
  backendUrl = `http://localhost:${await listen(backend)}`;
  for (const [name, provider] of Object.entries(config.providers)) {
    provider.redirectUris = [redirectUri(name)];
    provider.endpoints = Object.fromEntries(
      Object.entries(provider.endpoints).map(([key, value]) => [
        key,
        value.replace('http://localhost:4000', idpUrl),
      ])
    );
  }
});

after(() => {
  idp.close();
  backend.close();
});

/** What the system browser does: authorize, then follow the bounce. */
async function browserSignIn(name, extra = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'confidential-app',
    redirect_uri: redirectUri(name),
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

const pkce = { code_challenge: challenge, code_challenge_method: 'S256' };

const exchange = (name, body) =>
  fetch(`${backendUrl}/auth/${name}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirectUri: redirectUri(name), ...body }),
  });

test('the callback forwards code, state and errors to the app scheme', async () => {
  const app = await browserSignIn('github', pkce);
  assert.equal(app.protocol, 'presetsexample:');
  assert.equal(app.searchParams.get('state'), 'state-1');
  assert.ok(app.searchParams.get('code'));
  const denied = await browserSignIn('strava', { decision: 'deny' });
  assert.equal(denied.searchParams.get('error'), 'access_denied');
});

test('github: PKCE verifier, profile and primary email from /user/emails', async () => {
  const code = (await browserSignIn('github', pkce)).searchParams.get('code');
  const res = await exchange('github', { code, codeVerifier: verifier });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    provider: 'github',
    profile: {
      id: '583231',
      username: 'ada-lovelace',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
      picture: 'https://example.com/ada-github.png',
    },
  });
});

test('discord: profile with avatar URL; a wrong verifier is rejected', async () => {
  const code = (await browserSignIn('discord', pkce)).searchParams.get('code');
  const body = await (
    await exchange('discord', { code, codeVerifier: verifier })
  ).json();
  assert.equal(body.profile.username, 'ada');
  assert.equal(
    body.profile.picture,
    'https://cdn.discordapp.com/avatars/80351110224678912/a1b2c3.png'
  );

  const again = (await browserSignIn('discord', pkce)).searchParams.get('code');
  const missing = await exchange('discord', { code: again });
  assert.equal(missing.status, 400);
  const wrong = await exchange('discord', {
    code: again,
    codeVerifier: 'x'.repeat(43),
  });
  assert.equal(wrong.status, 502);
});

test('slack: id_token verified with the nonce of the sign-in', async () => {
  const signIn = async () =>
    (
      await browserSignIn('slack', {
        scope: 'openid profile email',
        nonce: 'n-1',
      })
    ).searchParams.get('code');

  const ok = await exchange('slack', { code: await signIn(), nonce: 'n-1' });
  assert.equal(ok.status, 200);
  const { profile } = await ok.json();
  assert.equal(profile.id, 'user-123');
  assert.equal(profile.email, 'ada@example.com');

  const other = await exchange('slack', { code: await signIn(), nonce: 'n-2' });
  assert.equal(other.status, 502);
  assert.equal((await other.json()).error, 'invalid_id_token');
});

test('strava: the athlete comes with the tokens', async () => {
  const code = (await browserSignIn('strava')).searchParams.get('code');
  const { profile } = await (await exchange('strava', { code })).json();
  assert.deepEqual(profile, {
    id: '227615',
    username: 'ada',
    name: 'Ada Lovelace',
    picture: 'https://example.com/ada-strava.jpg',
  });
});

test('unknown providers, foreign redirect URIs and missing PUBLIC_URL are rejected', async () => {
  assert.equal((await exchange('gitlab', { code: 'x' })).status, 404);
  const code = (await browserSignIn('strava')).searchParams.get('code');
  const foreign = await exchange('strava', {
    code,
    redirectUri: 'https://evil.test/cb',
  });
  assert.equal(foreign.status, 400);
  assert.throws(
    () => loadConfig({ GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' }),
    /https/
  );
  const mixed = loadConfig({
    GITHUB_CLIENT_ID: 'a',
    GITHUB_CLIENT_SECRET: 'b',
    PUBLIC_URL: 'https://x.test',
  });
  assert.equal(mixed.providers.github.real, true);
  assert.equal(mixed.providers.discord.real, false);
});
