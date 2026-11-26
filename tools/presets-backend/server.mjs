// Example backend for @franciscodlxdev/rn-oauth-presets.
//
// GitHub, Discord, Slack and Strava all need the client secret to exchange
// the code, so for each provider this server offers:
//   GET  /auth/<provider>/callback  forwards the provider's redirect to the
//                                   app's own URL scheme
//   POST /auth/<provider>/exchange  swaps the code for tokens with the secret
//                                   and returns the user profile
//
// Zero dependencies. A provider without credentials in the environment talks
// to examples/mock-idp, so the whole flow can be tried without any account.
import { createPublicKey, createVerify } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const MOCK = 'http://localhost:4000';

class HttpError extends Error {
  constructor(status, error, description) {
    super(description ?? error);
    this.status = status;
    this.body = { error, error_description: description };
  }
}

async function readJson(response, what) {
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Reported below through the status.
  }
  // Slack answers 200 with `ok: false`; the others use `error` or the status.
  if (
    !response.ok ||
    body.ok === false ||
    (body.error && !Array.isArray(body))
  ) {
    throw new HttpError(
      502,
      typeof body.error === 'string' ? body.error : 'provider_error',
      body.error_description ??
        body.message ??
        `${what} failed with status ${response.status}`
    );
  }
  return body;
}

const bearer = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/json',
  // GitHub's API rejects requests without a User-Agent.
  'User-Agent': 'presets-backend-example',
});

/** Verifies signature, issuer, audience, expiry and nonce of an RS256 id_token. */
export async function verifyIdToken(
  idToken,
  { jwksUri, issuer, clientId, nonce }
) {
  const [headerPart, payloadPart, signature] = idToken.split('.');
  if (!headerPart || !payloadPart || !signature) {
    throw new HttpError(502, 'invalid_id_token', 'Malformed id_token');
  }
  const header = JSON.parse(Buffer.from(headerPart, 'base64url'));
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url'));
  if (header.alg !== 'RS256') {
    throw new HttpError(
      502,
      'invalid_id_token',
      'Unexpected signing algorithm'
    );
  }
  const { keys = [] } = await readJson(await fetch(jwksUri), 'JWKS');
  const jwk =
    keys.find((key) => key.kid === header.kid) ?? (header.kid ? null : keys[0]);
  if (!jwk) {
    throw new HttpError(502, 'invalid_id_token', 'Unknown signing key');
  }
  const valid = createVerify('RSA-SHA256')
    .update(`${headerPart}.${payloadPart}`)
    .verify(
      createPublicKey({ key: jwk, format: 'jwk' }),
      signature,
      'base64url'
    );
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !valid ||
    claims.iss !== issuer ||
    !audiences.includes(clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 < Date.now() - 60_000 ||
    claims.nonce !== nonce
  ) {
    throw new HttpError(
      502,
      'invalid_id_token',
      'id_token verification failed'
    );
  }
  return claims;
}

/**
 * What differs per provider: endpoints, which proof the app must send along
 * with the code, and how the profile is obtained.
 */
const PROVIDERS = {
  github: {
    real: {
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      userEndpoint: 'https://api.github.com/user',
      emailsEndpoint: 'https://api.github.com/user/emails',
    },
    mock: {
      tokenEndpoint: `${MOCK}/token`,
      userEndpoint: `${MOCK}/user`,
      emailsEndpoint: `${MOCK}/user/emails`,
    },
    proof: 'codeVerifier',
    async profile(tokens, endpoints) {
      const user = await readJson(
        await fetch(endpoints.userEndpoint, {
          headers: bearer(tokens.access_token),
        }),
        'User request'
      );
      let email = user.email ?? undefined;
      let emailVerified;
      if (!email) {
        // The public email is optional; the primary one needs `user:email`.
        const emails = await readJson(
          await fetch(endpoints.emailsEndpoint, {
            headers: bearer(tokens.access_token),
          }),
          'Emails request'
        );
        const primary = Array.isArray(emails)
          ? emails.find((entry) => entry.primary)
          : undefined;
        email = primary?.email;
        emailVerified = primary?.verified;
      }
      return {
        id: String(user.id),
        username: user.login,
        name: user.name ?? undefined,
        email,
        emailVerified,
        picture: user.avatar_url,
      };
    },
  },
  discord: {
    real: {
      tokenEndpoint: 'https://discord.com/api/oauth2/token',
      userEndpoint: 'https://discord.com/api/users/@me',
    },
    mock: { tokenEndpoint: `${MOCK}/token`, userEndpoint: `${MOCK}/users/@me` },
    proof: 'codeVerifier',
    async profile(tokens, endpoints) {
      const user = await readJson(
        await fetch(endpoints.userEndpoint, {
          headers: bearer(tokens.access_token),
        }),
        'User request'
      );
      return {
        id: String(user.id),
        username: user.username,
        name: user.global_name ?? undefined,
        email: user.email ?? undefined,
        emailVerified: user.verified,
        picture: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : undefined,
      };
    },
  },
  slack: {
    real: {
      tokenEndpoint: 'https://slack.com/api/openid.connect.token',
      jwksUri: 'https://slack.com/openid/connect/keys',
      issuer: 'https://slack.com',
    },
    mock: {
      tokenEndpoint: `${MOCK}/token`,
      jwksUri: `${MOCK}/jwks`,
      issuer: MOCK,
    },
    proof: 'nonce',
    async profile(tokens, endpoints, { clientId, nonce }) {
      if (!tokens.id_token) {
        throw new HttpError(
          502,
          'invalid_id_token',
          'No id_token in the response'
        );
      }
      const claims = await verifyIdToken(tokens.id_token, {
        jwksUri: endpoints.jwksUri,
        issuer: endpoints.issuer,
        clientId,
        nonce,
      });
      return {
        id: String(claims.sub),
        name: claims.name,
        email: claims.email,
        emailVerified: claims.email_verified,
        picture: claims.picture,
      };
    },
  },
  strava: {
    real: { tokenEndpoint: 'https://www.strava.com/oauth/token' },
    mock: { tokenEndpoint: `${MOCK}/token` },
    proof: null,
    async profile(tokens) {
      const athlete = tokens.athlete;
      if (!athlete?.id) {
        throw new HttpError(
          502,
          'provider_error',
          'No athlete in the response'
        );
      }
      return {
        id: String(athlete.id),
        username: athlete.username ?? undefined,
        name:
          [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') ||
          undefined,
        picture: athlete.profile,
      };
    },
  },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 4400);
  const publicUrl = env.PUBLIC_URL?.replace(/\/+$/, '');
  const providers = {};
  for (const name of PROVIDER_NAMES) {
    const prefix = name.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    const real = Boolean(clientId && clientSecret);
    if (real && !publicUrl?.startsWith('https://')) {
      throw new Error('PUBLIC_URL must be the public https URL of this server');
    }
    const path = `/auth/${name}/callback`;
    providers[name] = {
      real,
      clientId: real ? clientId : 'confidential-app',
      clientSecret: real ? clientSecret : 'mock-secret',
      endpoints: PROVIDERS[name][real ? 'real' : 'mock'],
      // With the mock provider the Android emulator reaches the host machine
      // through 10.0.2.2.
      redirectUris: real
        ? [`${publicUrl}${path}`]
        : [`http://localhost:${port}${path}`, `http://10.0.2.2:${port}${path}`],
    };
  }
  return {
    port,
    appCallback: env.APP_CALLBACK || 'presetsexample://callback',
    providers,
  };
}

export async function exchange(name, body, config) {
  const definition = PROVIDERS[name];
  const provider = config.providers[name];
  const { code, redirectUri } = body;
  if (typeof code !== 'string' || !code) {
    throw new HttpError(400, 'invalid_request', 'code is required');
  }
  // PKCE verifier or OpenID Connect nonce: what ties the code to the app
  // instance that started the sign-in.
  const proof = definition.proof ? body[definition.proof] : undefined;
  if (definition.proof && (typeof proof !== 'string' || !proof)) {
    throw new HttpError(
      400,
      'invalid_request',
      `${definition.proof} is required`
    );
  }
  // The app does not get to choose where codes are valid.
  if (!provider.redirectUris.includes(redirectUri)) {
    throw new HttpError(400, 'invalid_request', 'Unexpected redirectUri');
  }

  const tokens = await readJson(
    await fetch(provider.endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json', // GitHub answers form-encoded otherwise
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        ...(definition.proof === 'codeVerifier'
          ? { code_verifier: proof }
          : {}),
      }),
    }),
    'Token request'
  );

  // A real backend would now create ITS OWN session for this user and keep
  // the provider's tokens on the server.
  return {
    provider: name,
    profile: await definition.profile(tokens, provider.endpoints, {
      clientId: provider.clientId,
      nonce: proof,
    }),
  };
}

export function createBackend(config = loadConfig(), log = () => {}) {
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://placeholder');
    log(`${req.method} ${url.pathname}`);
    try {
      const match = /^\/auth\/([a-z]+)\/(callback|exchange)$/.exec(
        url.pathname
      );
      const name = match && PROVIDER_NAMES.includes(match[1]) ? match[1] : null;
      if (name && match[2] === 'callback' && req.method === 'GET') {
        // Bounce: hand the provider's response (code, state or error) to the
        // app. The target is fixed in config, never taken from the request.
        const separator = config.appCallback.includes('?') ? '&' : '?';
        return send(res, 302, undefined, {
          Location: `${config.appCallback}${url.search ? separator + url.search.slice(1) : ''}`,
        });
      }
      if (name && match[2] === 'exchange' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 16_384) {
            throw new HttpError(413, 'invalid_request', 'Body too large');
          }
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HttpError(400, 'invalid_request', 'Body must be JSON');
        }
        return send(res, 200, await exchange(name, body ?? {}, config));
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, {
          ok: true,
          providers: Object.fromEntries(
            PROVIDER_NAMES.map((n) => [
              n,
              config.providers[n].real ? 'real' : 'mock',
            ])
          ),
        });
      }
      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof HttpError) {
        return send(res, error.status, error.body);
      }
      log(`error: ${error}`);
      return send(res, 500, { error: 'server_error' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  createBackend(config, (line) => console.log(`[backend] ${line}`)).listen(
    config.port,
    () => {
      console.log(`[backend] http://localhost:${config.port}`);
      for (const name of PROVIDER_NAMES) {
        const provider = config.providers[name];
        console.log(
          `[backend] ${name} (${provider.real ? 'real' : 'mock'}): ${provider.redirectUris.join(', ')}`
        );
      }
    }
  );
}
