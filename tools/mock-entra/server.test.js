const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createServer } = require('./server');

let server;
let base;

before(async () => {
  ({ server } = createServer());
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}/mock-tenant`;
});
after(() => server.close());

async function post(path, form) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: 'mock-entra-client', ...form }),
  });
  return { status: res.status, body: await res.json() };
}

test('password sign-in over HTTP returns tokens', async () => {
  const started = await post('/oauth2/v2.0/initiate', {
    username: 'ada@example.com',
    challenge_type: 'password redirect',
  });
  const challenged = await post('/oauth2/v2.0/challenge', {
    continuation_token: started.body.continuation_token,
    challenge_type: 'password redirect',
  });
  assert.equal(challenged.body.challenge_type, 'password');
  const tokens = await post('/oauth2/v2.0/token', {
    continuation_token: challenged.body.continuation_token,
    grant_type: 'password',
    password: 'Passw0rd!',
    scope: 'openid offline_access',
  });
  assert.equal(tokens.status, 200);
  assert.ok(tokens.body.id_token && tokens.body.refresh_token);
});

test('a request without redirect, a wrong client and an unknown user fail', async () => {
  const noRedirect = await post('/oauth2/v2.0/initiate', {
    username: 'ada@example.com',
    challenge_type: 'password',
  });
  assert.equal(noRedirect.body.error, 'invalid_request');
  const res = await fetch(`${base}/oauth2/v2.0/initiate`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: 'other', username: 'x' }),
  });
  assert.equal((await res.json()).error, 'unauthorized_client');
  const unknown = await post('/oauth2/v2.0/initiate', {
    username: 'nobody@example.com',
    challenge_type: 'password redirect',
  });
  assert.equal(unknown.body.error, 'user_not_found');
});
