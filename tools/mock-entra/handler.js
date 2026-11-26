// In-memory stand-in for the Microsoft Entra External ID native
// authentication API (sign-in, sign-up, password reset). It follows the
// request/response shapes of Microsoft's reference; it is NOT Entra and
// checks nothing a real tenant would (no MFA, no throttling, no real email).
//
// The one-time passcode is always the same (default 12345678) so flows can be
// scripted. Accounts:
//   ada@example.com / Passw0rd!   email + password
//   otp@example.com               email one-time passcode (no password)
//   sso@example.com               always answers `redirect` (web fallback)
/* global Buffer */
const crypto = require('crypto');

const b64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function createMockEntra({
  otp = '12345678',
  clientId = 'mock-entra-client',
  issuer = 'https://mock.ciamlogin.com/mock-tenant/v2.0',
  // Attributes the "user flow" collects at sign-up.
  requiredAttributes = ['displayName'],
  log = () => {},
} = {}) {
  const users = new Map([
    ['ada@example.com', { password: 'Passw0rd!', name: 'Ada Lovelace' }],
    ['otp@example.com', { password: null, name: 'Otto Passcode' }],
    ['sso@example.com', { redirect: true, name: 'Sso Fallback' }],
  ]);
  const sessions = new Map(); // continuation token → flow state
  const refreshTokens = new Map(); // refresh token → username

  const error = (status, name, description, extra = {}) => ({
    status,
    body: {
      error: name,
      error_description: description,
      error_codes: [extra.code ?? 90000],
      timestamp: new Date().toISOString(),
      trace_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      ...extra.fields,
    },
  });
  const ok = (body) => ({ status: 200, body });

  /** Continuation tokens are single use: each step hands out a new one. */
  function next(state) {
    const token = `ct-${crypto.randomBytes(12).toString('base64url')}`;
    sessions.set(token, state);
    return token;
  }
  function take(form) {
    const state = sessions.get(form.continuation_token);
    sessions.delete(form.continuation_token);
    return state;
  }
  const expired = () =>
    error(400, 'expired_token', 'The continuation token is expired.', {
      code: 552003,
    });

  function passwordProblem(password) {
    if (typeof password !== 'string' || password.length < 8) {
      return 'password_too_short';
    }
    if (!/[0-9]/.test(password) || !/[a-zA-Z]/.test(password)) {
      return 'password_too_weak';
    }
    return null;
  }
  const badPassword = (suberror, state) =>
    error(400, 'invalid_grant', 'The password does not meet the policy.', {
      fields: { suberror, continuation_token: next(state) },
    });

  function issueTokens(username, scope = '') {
    const user = users.get(username);
    const scopes = scope.split(' ');
    const now = Math.floor(Date.now() / 1000);
    const body = {
      token_type: 'Bearer',
      scope,
      expires_in: 3600,
      access_token: `at-${crypto.randomBytes(16).toString('base64url')}`,
    };
    if (scopes.includes('openid')) {
      // Not a real signature: the app only decodes it, and a backend would
      // verify a real tenant's token against its JWKS.
      body.id_token = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
        iss: issuer,
        aud: clientId,
        sub: `sub-${username}`,
        oid: user.oid,
        name: user.name,
        preferred_username: username,
        iat: now,
        exp: now + 3600,
      })}.mock-signature`;
    }
    if (scopes.includes('offline_access')) {
      body.refresh_token = `rt-${crypto.randomBytes(16).toString('base64url')}`;
      refreshTokens.set(body.refresh_token, username);
    }
    return ok(body);
  }

  const oobChallenge = (state, username) =>
    ok({
      continuation_token: next({ ...state, codeSent: true }),
      challenge_type: 'oob',
      binding_method: 'prompt',
      challenge_channel: 'email',
      challenge_target_label: username.replace(
        /^(.).*(@.).*(\..+)$/,
        '$1***$2***$3'
      ),
      code_length: otp.length,
      interval: 300,
    });

  const offered = (form) => (form.challenge_type ?? '').split(' ');

  const routes = {
    // ---- sign-in -----------------------------------------------------------
    '/oauth2/v2.0/initiate'(form) {
      const user = users.get(form.username);
      if (!user) {
        return error(400, 'user_not_found', 'The user was not found.', {
          code: 1003037,
        });
      }
      if (user.redirect) {
        return ok({ challenge_type: 'redirect' });
      }
      return ok({
        continuation_token: next({ flow: 'signIn', username: form.username }),
      });
    },
    '/oauth2/v2.0/challenge'(form) {
      const state = take(form);
      if (!state || state.flow !== 'signIn') {
        return expired();
      }
      const user = users.get(state.username);
      if (user.password) {
        // A password account that does not offer `password` falls back to
        // the browser.
        return offered(form).includes('password')
          ? ok({ challenge_type: 'password', continuation_token: next(state) })
          : ok({ challenge_type: 'redirect' });
      }
      return oobChallenge(state, state.username);
    },
    '/oauth2/v2.0/token'(form) {
      if (form.grant_type === 'refresh_token') {
        const username = refreshTokens.get(form.refresh_token);
        refreshTokens.delete(form.refresh_token);
        return username
          ? issueTokens(username, form.scope)
          : error(400, 'invalid_grant', 'The refresh token is invalid.');
      }
      const state = take(form);
      if (!state) {
        return expired();
      }
      const user = users.get(state.username);
      if (form.grant_type === 'password') {
        return state.flow === 'signIn' && user.password === form.password
          ? issueTokens(state.username, form.scope)
          : error(400, 'invalid_grant', 'Invalid username or password.', {
              code: 50126,
            });
      }
      if (form.grant_type === 'oob') {
        return state.flow === 'signIn' && state.codeSent && form.oob === otp
          ? issueTokens(state.username, form.scope)
          : error(400, 'invalid_grant', 'The one-time passcode is wrong.', {
              fields: {
                suberror: 'invalid_oob_value',
                continuation_token: next(state),
              },
            });
      }
      if (form.grant_type === 'continuation_token') {
        return state.done
          ? issueTokens(state.username, form.scope)
          : error(400, 'invalid_grant', 'The flow is not complete.');
      }
      return error(400, 'unsupported_grant_type', 'Unsupported grant type.');
    },

    // ---- sign-up -----------------------------------------------------------
    '/signup/v1.0/start'(form) {
      if (users.has(form.username)) {
        return error(400, 'user_already_exists', 'The user already exists.', {
          code: 1003037,
        });
      }
      if (form.password !== undefined) {
        const problem = passwordProblem(form.password);
        if (problem) {
          return error(
            400,
            'invalid_grant',
            'The password does not meet the policy.',
            {
              fields: { suberror: problem },
            }
          );
        }
      }
      let attributes = {};
      try {
        attributes = form.attributes ? JSON.parse(form.attributes) : {};
      } catch {
        return error(400, 'invalid_request', 'attributes must be JSON.');
      }
      return ok({
        continuation_token: next({
          flow: 'signUp',
          username: form.username,
          password: form.password,
          attributes,
        }),
      });
    },
    '/signup/v1.0/challenge'(form) {
      const state = take(form);
      if (!state || state.flow !== 'signUp') {
        return expired();
      }
      if (state.verified) {
        return ok({
          challenge_type: 'password',
          continuation_token: next(state),
        });
      }
      return oobChallenge(state, state.username);
    },
    '/signup/v1.0/continue'(form) {
      const state = take(form);
      if (!state || state.flow !== 'signUp') {
        return expired();
      }
      if (form.grant_type === 'oob') {
        if (!state.codeSent || form.oob !== otp) {
          return error(
            400,
            'invalid_grant',
            'The one-time passcode is wrong.',
            {
              fields: {
                suberror: 'invalid_oob_value',
                continuation_token: next(state),
              },
            }
          );
        }
        state.verified = true;
      } else if (form.grant_type === 'password') {
        const problem = passwordProblem(form.password);
        if (problem) {
          return badPassword(problem, state);
        }
        state.password = form.password;
      } else if (form.grant_type === 'attributes') {
        try {
          Object.assign(state.attributes, JSON.parse(form.attributes));
        } catch {
          return error(400, 'invalid_request', 'attributes must be JSON.');
        }
      } else {
        return error(400, 'unsupported_grant_type', 'Unsupported grant type.');
      }
      if (!state.verified) {
        return error(400, 'invalid_grant', 'Verify the email first.');
      }
      if (!state.password) {
        return error(400, 'credential_required', 'A credential is required.', {
          code: 55103,
          fields: { continuation_token: next(state) },
        });
      }
      const missing = requiredAttributes.filter(
        (name) => !state.attributes[name]
      );
      if (missing.length > 0) {
        return error(400, 'attributes_required', 'User attributes required.', {
          code: 55106,
          fields: {
            continuation_token: next(state),
            required_attributes: missing.map((name) => ({
              name,
              type: 'string',
              required: true,
            })),
          },
        });
      }
      users.set(state.username, {
        password: state.password,
        name: state.attributes.displayName ?? state.username,
        oid: crypto.randomUUID(),
      });
      log(`signed up ${state.username}`);
      return ok({
        continuation_token: next({ username: state.username, done: true }),
      });
    },

    // ---- password reset ----------------------------------------------------
    '/resetpassword/v1.0/start'(form) {
      const user = users.get(form.username);
      if (!user) {
        return error(400, 'user_not_found', 'The user was not found.');
      }
      if (!user.password) {
        return ok({ challenge_type: 'redirect' });
      }
      return ok({
        continuation_token: next({ flow: 'reset', username: form.username }),
      });
    },
    '/resetpassword/v1.0/challenge'(form) {
      const state = take(form);
      return state && state.flow === 'reset'
        ? oobChallenge(state, state.username)
        : expired();
    },
    '/resetpassword/v1.0/continue'(form) {
      const state = take(form);
      if (!state || state.flow !== 'reset') {
        return expired();
      }
      if (form.grant_type !== 'oob' || !state.codeSent || form.oob !== otp) {
        return error(400, 'invalid_grant', 'The one-time passcode is wrong.', {
          fields: {
            suberror: 'invalid_oob_value',
            continuation_token: next(state),
          },
        });
      }
      return ok({
        continuation_token: next({ ...state, verified: true }),
        expires_in: 600,
      });
    },
    '/resetpassword/v1.0/submit'(form) {
      const state = take(form);
      if (!state || state.flow !== 'reset' || !state.verified) {
        return expired();
      }
      const problem = passwordProblem(form.new_password);
      if (problem) {
        return badPassword(problem, state);
      }
      users.get(state.username).password = form.new_password;
      log(`password reset for ${state.username}`);
      return ok({
        continuation_token: next({ ...state, submitted: true, polls: 0 }),
        poll_interval: 1,
      });
    },
    '/resetpassword/v1.0/poll_completion'(form) {
      const state = take(form);
      if (!state || !state.submitted) {
        return expired();
      }
      // The first poll is always "in progress", like a real directory write.
      if (state.polls === 0) {
        return ok({
          status: 'in_progress',
          continuation_token: next({ ...state, polls: 1 }),
        });
      }
      return ok({
        status: 'succeeded',
        continuation_token: next({ username: state.username, done: true }),
        expires_in: 600,
      });
    },
  };

  for (const user of users.values()) {
    user.oid = crypto.randomUUID();
  }

  /** `path` may carry the tenant prefix; only its known suffix matters. */
  function handle(path, form) {
    const route = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    if (!route) {
      return { status: 404, body: { error: 'not_found' } };
    }
    if (form.client_id !== clientId) {
      return error(400, 'unauthorized_client', 'The client id is incorrect.');
    }
    // Sign-in, sign-up and reset starts must offer the web fallback.
    if (
      /(initiate|start)$/.test(route) &&
      !offered(form).includes('redirect')
    ) {
      return error(
        400,
        'invalid_request',
        'challenge_type must include redirect.'
      );
    }
    log(`POST ${route}`);
    return routes[route](form);
  }

  return { handle, otp, clientId };
}

module.exports = { createMockEntra };
