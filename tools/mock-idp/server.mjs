// Local OAuth 2.0 / OpenID Connect provider for the example apps.
// It behaves like a real provider for a PUBLIC client: authorization code +
// PKCE (S256), no client secret. Not for production use.
//
// The client id `confidential-app` (secret `mock-secret`) behaves like
// providers that need a backend, e.g. LinkedIn: PKCE is optional and the token
// endpoint requires the client secret.
//
// It also answers `GET /2/users/me` in the shape of the X API v2, and for
// X scopes (`users.read`) it only issues a refresh token with
// `offline.access` and the email with `users.email`.
//
// For the presets: `GET /user` and `/user/emails` (GitHub), `GET /users/@me`
// (Discord) and an `athlete` object in the token response (Strava).
//
// The token endpoint also accepts HTTP Basic client authentication, and the
// `phone` scope adds Telegram-style claims to the id_token.
//
// TikTok: `client_key` is accepted in place of `client_id`, the redirect
// echoes `scopes`, and `GET /v2/user/info/` answers in TikTok's envelope.
//
// A request carrying the OpenID Connect `claims` parameter is answered like
// Twitch: `sub` plus only the claims that were asked for.
//
//   node server.mjs                  → consent page with Approve / Deny
//   MOCK_IDP_AUTO=approve node …     → redirects back immediately (for e2e)
//   MOCK_IDP_AUTO=deny node …        → always answers access_denied
//   MOCK_IDP_DENY_ERROR=user_cancelled_login → error code used when denying
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const USER = {
  sub: 'user-123',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  email_verified: true,
};

/** Clients that must authenticate with a secret at the token endpoint. */
export const CONFIDENTIAL_CLIENTS = { 'confidential-app': 'mock-secret' };

/** Same user in the shape of X's `GET /2/users/me`. */
const X_USER = {
  id: '2244994945',
  name: USER.name,
  username: 'ada_lovelace',
  profile_image_url: 'https://example.com/ada_normal.jpg',
  verified: false,
  confirmed_email: USER.email,
};

/** Claims a Twitch-style client can ask for through the `claims` parameter. */
const TWITCH_CLAIMS = {
  email: USER.email,
  email_verified: true,
  picture: 'https://example.com/ada-twitch.png',
  preferred_username: 'AdaLovelace',
  updated_at: '2026-01-01T00:00:00Z',
};

/** Twitch only returns `sub` plus the claims named in `claims`. */
function requestedClaims(claimsParam, target) {
  let wanted = {};
  try {
    wanted = JSON.parse(claimsParam)?.[target] ?? {};
  } catch {
    // Malformed `claims`: nothing extra is returned.
  }
  return {
    sub: USER.sub,
    ...Object.fromEntries(
      Object.entries(TWITCH_CLAIMS).filter(([name]) => name in wanted)
    ),
  };
}

const b64url = (input) => Buffer.from(input).toString('base64url');
const sha256 = (input) =>
  createHash('sha256').update(input).digest('base64url');

export function createMockIdp({
  issuer = 'http://localhost:4000',
  auto = process.env.MOCK_IDP_AUTO ?? '',
  denyError = process.env.MOCK_IDP_DENY_ERROR || 'access_denied',
  log = () => {},
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'mock-1',
    use: 'sig',
    alg: 'RS256',
  };
  const codes = new Map(); // code → pending authorization
  const refreshTokens = new Map(); // refresh token → granted scope
  const tokens = new Map(); // live access token → granted scope
  const tokenClaims = new Map(); // live access token → `claims` parameter

  function signIdToken(claims) {
    const header = b64url(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })
    );
    const payload = b64url(JSON.stringify(claims));
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${payload}`)
      .sign(privateKey)
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string';
    res.writeHead(status, {
      'Content-Type': isJson ? 'application/json' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  const redirect = (res, to) => send(res, 302, '', { Location: to });

  function withParams(uri, params) {
    const query = new URLSearchParams(params).toString();
    return `${uri}${uri.includes('?') ? '&' : '?'}${query}`;
  }

  function authorize(url, res) {
    const q = Object.fromEntries(url.searchParams);
    q.client_id ??= q.client_key; // TikTok's name for the client id
    if (!q.client_id || !q.redirect_uri) {
      return send(res, 400, '<h1>Missing client_id or redirect_uri</h1>');
    }
    const fail = (error, description) =>
      redirect(
        res,
        withParams(q.redirect_uri, {
          error,
          error_description: description,
          ...(q.state ? { state: q.state } : {}),
        })
      );

    if (q.response_type !== 'code') {
      return fail(
        'unsupported_response_type',
        'Only response_type=code is supported'
      );
    }
    const confidential = q.client_id in CONFIDENTIAL_CLIENTS;
    const hasPkce =
      Boolean(q.code_challenge) && q.code_challenge_method === 'S256';
    if (!hasPkce && (!confidential || q.code_challenge)) {
      return fail('invalid_request', 'PKCE with S256 is required');
    }

    const decision = url.searchParams.get('decision') ?? auto;
    if (decision === 'deny') {
      return fail(denyError, 'The user denied the request');
    }
    if (decision === 'approve') {
      const code = randomBytes(16).toString('base64url');
      codes.set(code, {
        clientId: q.client_id,
        redirectUri: q.redirect_uri,
        codeChallenge: q.code_challenge,
        nonce: q.nonce,
        claims: q.claims,
        scope: q.scope ?? '',
        expiresAt: Date.now() + 60_000,
      });
      log(`issued code for ${q.client_id}`);
      return redirect(
        res,
        withParams(q.redirect_uri, {
          code,
          // TikTok echoes the granted scopes, comma-separated.
          ...(q.client_key ? { scopes: q.scope ?? '' } : {}),
          ...(q.state ? { state: q.state } : {}),
        })
      );
    }

    const link = (value) => {
      const next = new URL(url);
      next.searchParams.set('decision', value);
      return `${next.pathname}${next.search}`.replace(/&/g, '&amp;');
    };
    return send(
      res,
      200,
      `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock IdP</title>
<body style="font-family: system-ui; padding: 24px; max-width: 480px; margin: auto">
<h1>Mock IdP</h1>
<p><b>${escapeHtml(q.client_id)}</b> wants to sign you in as ${USER.name}.</p>
<p>Scopes: <code>${escapeHtml(q.scope ?? '(none)')}</code></p>
<p><a id="approve" href="${link('approve')}" style="display:block;padding:16px;background:#1f6feb;color:#fff;text-align:center;border-radius:8px;text-decoration:none">Approve</a></p>
<p><a id="deny" href="${link('deny')}" style="display:block;padding:16px;text-align:center">Deny</a></p>
</body>`
    );
  }

  function token(form, res) {
    const secret = CONFIDENTIAL_CLIENTS[form.client_id];
    if (secret !== undefined && form.client_secret !== secret) {
      return send(res, 401, {
        error: 'invalid_client',
        error_description: 'client_secret is missing or wrong',
      });
    }

    const invalid = (description) =>
      send(res, 400, {
        error: 'invalid_grant',
        error_description: description,
      });

    if (form.grant_type === 'refresh_token') {
      if (!refreshTokens.has(form.refresh_token)) {
        return invalid('Unknown refresh token');
      }
      // Rotation: a refresh token works once.
      form.scope = refreshTokens.get(form.refresh_token);
      refreshTokens.delete(form.refresh_token);
    } else if (form.grant_type === 'authorization_code') {
      const pending = codes.get(form.code);
      codes.delete(form.code); // single use
      if (!pending || pending.expiresAt < Date.now()) {
        return invalid('Unknown or expired code');
      }
      if (
        pending.clientId !== form.client_id ||
        pending.redirectUri !== form.redirect_uri
      ) {
        return invalid(
          'client_id or redirect_uri does not match the authorization request'
        );
      }
      if (
        pending.codeChallenge &&
        (!form.code_verifier ||
          sha256(form.code_verifier) !== pending.codeChallenge)
      ) {
        return invalid('PKCE verification failed');
      }
      form.nonce = pending.nonce;
      form.claims = pending.claims;
      form.scope = pending.scope;
    } else {
      return send(res, 400, { error: 'unsupported_grant_type' });
    }

    const accessToken = `at-${randomBytes(16).toString('base64url')}`;
    const scope = form.scope ?? '';
    tokens.set(accessToken, scope);
    if (form.claims) {
      tokenClaims.set(accessToken, form.claims);
    }
    // Like X: a refresh token only with the `offline.access` scope; OpenID
    // Connect clients (no X scopes) always get one.
    const xStyle = scope.split(' ').includes('users.read');
    let refreshToken;
    if (!xStyle || scope.split(' ').includes('offline.access')) {
      refreshToken = `rt-${randomBytes(16).toString('base64url')}`;
      refreshTokens.set(refreshToken, scope);
    }
    const now = Math.floor(Date.now() / 1000);
    return send(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      scope,
      // Strava returns the athlete with the tokens.
      athlete: {
        id: 227615,
        username: 'ada',
        firstname: 'Ada',
        lastname: 'Lovelace',
        profile: 'https://example.com/ada-strava.jpg',
      },
      id_token: signIdToken({
        iss: issuer,
        aud: form.client_id,
        iat: now,
        exp: now + 3600,
        ...(form.nonce ? { nonce: form.nonce } : {}),
        ...(form.claims ? requestedClaims(form.claims, 'id_token') : USER),
        // Telegram has no userinfo endpoint: everything is in the id_token.
        ...(scope.split(' ').includes('phone')
          ? {
              id: 987654321,
              preferred_username: 'ada_lovelace',
              picture: 'https://example.com/ada-telegram.jpg',
              phone_number: '+5215500000000',
            }
          : {}),
      }),
    });
  }

  async function readForm(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    return Object.fromEntries(new URLSearchParams(body));
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    log(`${req.method} ${url.pathname}`);
    try {
      if (
        req.method === 'GET' &&
        url.pathname === '/.well-known/openid-configuration'
      ) {
        return send(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          revocation_endpoint: `${issuer}/revoke`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      }
      if (req.method === 'GET' && url.pathname === '/jwks') {
        return send(res, 200, { keys: [jwk] });
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        return authorize(url, res);
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const form = await readForm(req);
        // client_secret_basic, as Telegram uses it.
        const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? '');
        if (basic) {
          const [id, ...rest] = Buffer.from(basic[1], 'base64')
            .toString()
            .split(':');
          form.client_id ??= id;
          form.client_secret ??= rest.join(':');
        }
        form.client_id ??= form.client_key;
        return token(form, res);
      }
      if (req.method === 'GET' && url.pathname === '/userinfo') {
        const bearer = (req.headers.authorization ?? '').replace(
          /^Bearer /i,
          ''
        );
        if (!tokens.has(bearer)) {
          return send(res, 401, { error: 'invalid_token' });
        }
        return send(
          res,
          200,
          tokenClaims.has(bearer)
            ? requestedClaims(tokenClaims.get(bearer), 'userinfo')
            : USER
        );
      }
      // X API v2: the user comes wrapped in `data`, with only the requested
      // fields, and the email needs the `users.email` scope.
      if (req.method === 'GET' && url.pathname === '/2/users/me') {
        const bearer = (req.headers.authorization ?? '').replace(
          /^Bearer /i,
          ''
        );
        if (!tokens.has(bearer)) {
          return send(res, 401, {
            title: 'Unauthorized',
            status: 401,
            detail: 'Unauthorized',
          });
        }
        const scopes = tokens.get(bearer).split(' ');
        const fields = new Set([
          'id',
          'name',
          'username',
          ...(url.searchParams.get('user.fields') ?? '').split(','),
        ]);
        if (!scopes.includes('users.email')) {
          fields.delete('confirmed_email');
        }
        return send(res, 200, {
          data: Object.fromEntries(
            Object.entries(X_USER).filter(([key]) => fields.has(key))
          ),
        });
      }
      // Mercado Libre: `GET /users/me`, a flat object with a numeric id.
      if (req.method === 'GET' && url.pathname === '/users/me') {
        const bearer = (req.headers.authorization ?? '').replace(
          /^Bearer /i,
          ''
        );
        return tokens.has(bearer)
          ? send(res, 200, {
              id: 202593498,
              nickname: 'ADA.LOVELACE',
              first_name: 'Ada',
              last_name: 'Lovelace',
              email: USER.email,
              country_id: 'MX',
              site_id: 'MLM',
              thumbnail: {
                picture_id: 'mock',
                picture_url: 'https://example.com/ada.jpg',
              },
            })
          : send(res, 401, { message: 'invalid_token', status: 401 });
      }
      // TikTok: `GET /v2/user/info/?fields=…`, wrapped in `data.user` with an
      // `error` object whose code is "ok" on success.
      if (req.method === 'GET' && url.pathname === '/v2/user/info/') {
        const bearer = (req.headers.authorization ?? '').replace(
          /^Bearer /i,
          ''
        );
        if (!tokens.has(bearer)) {
          return send(res, 401, {
            data: {},
            error: {
              code: 'access_token_invalid',
              message: 'The access token is invalid.',
              log_id: 'mock',
            },
          });
        }
        const all = {
          open_id: '723f24d7-e717-40f8-a2b6-cb8464cd23b4',
          union_id: 'c9c60f44-a68e-4f5d-84dd-ce22faeb0ba1',
          avatar_url: 'https://example.com/ada-tiktok.jpeg',
          display_name: USER.name,
          username: 'ada.lovelace',
        };
        const fields = (url.searchParams.get('fields') ?? '').split(',');
        return send(res, 200, {
          data: {
            user: Object.fromEntries(
              Object.entries(all).filter(([key]) => fields.includes(key))
            ),
          },
          error: { code: 'ok', message: '', log_id: 'mock' },
        });
      }
      // GitHub (`GET /user`) and Discord (`GET /users/@me`) user objects.
      if (
        req.method === 'GET' &&
        (url.pathname === '/user' || url.pathname === '/users/@me')
      ) {
        const bearer = (req.headers.authorization ?? '').replace(
          /^Bearer /i,
          ''
        );
        if (!tokens.has(bearer)) {
          return send(res, 401, { message: 'Bad credentials' });
        }
        return send(
          res,
          200,
          url.pathname === '/user'
            ? {
                id: 583231,
                login: 'ada-lovelace',
                name: USER.name,
                email: null, // private email: see /user/emails
                avatar_url: 'https://example.com/ada-github.png',
              }
            : {
                id: '80351110224678912',
                username: 'ada',
                global_name: USER.name,
                avatar: 'a1b2c3',
                email: USER.email,
                verified: true,
              }
        );
      }
      if (req.method === 'GET' && url.pathname === '/user/emails') {
        const bearer = (req.headers.authorization ?? '').replace(
          /^Bearer /i,
          ''
        );
        return tokens.has(bearer)
          ? send(res, 200, [
              { email: 'old@example.com', primary: false, verified: true },
              { email: USER.email, primary: true, verified: true },
            ])
          : send(res, 401, { message: 'Bad credentials' });
      }
      if (req.method === 'POST' && url.pathname === '/revoke') {
        tokens.delete((await readForm(req)).token);
        return send(res, 200, {});
      }
      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      return send(res, 500, {
        error: 'server_error',
        error_description: String(error),
      });
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 4000);
  createMockIdp({ log: (line) => console.log(`[mock-idp] ${line}`) }).listen(
    port,
    () => {
      console.log(
        `[mock-idp] http://localhost:${port} (auto: ${process.env.MOCK_IDP_AUTO || 'off'})`
      );
    }
  );
}
