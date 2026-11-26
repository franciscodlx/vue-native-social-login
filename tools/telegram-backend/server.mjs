// Example backend for @franciscodlxdev/react-native-telegram-login.
//
// Telegram needs two things a mobile app cannot provide:
//   1. an https redirect URI      → GET  /auth/telegram/callback forwards the
//                                    browser to the app's own URL scheme
//   2. the client secret at the   → POST /auth/telegram/exchange swaps the code
//      token endpoint               for tokens and returns the member profile
//
// Zero dependencies. PROVIDER=mock (default) talks to examples/mock-idp so the
// whole flow can be tried without a Telegram app.
import { createPublicKey, createVerify } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const CALLBACK_PATH = '/auth/telegram/callback';

const PROVIDERS = {
  telegram: {
    issuer: 'https://oauth.telegram.org',
    tokenEndpoint: 'https://oauth.telegram.org/token',
    jwksUri: 'https://oauth.telegram.org/.well-known/jwks.json',
  },
  mock: {
    issuer: 'http://localhost:4000',
    tokenEndpoint: 'http://localhost:4000/token',
    jwksUri: 'http://localhost:4000/jwks',
  },
};

export function loadConfig(env = process.env) {
  const providerName = env.PROVIDER === 'telegram' ? 'telegram' : 'mock';
  const port = Number(env.PORT ?? 4500);
  const mock = providerName === 'mock';
  const config = {
    providerName,
    provider: PROVIDERS[providerName],
    port,
    clientId: env.TELEGRAM_CLIENT_ID || (mock ? 'confidential-app' : ''),
    clientSecret: env.TELEGRAM_CLIENT_SECRET || (mock ? 'mock-secret' : ''),
    appCallback: env.APP_CALLBACK || 'telegramexample://callback',
    // Redirect URIs this server answers for. With the mock provider the
    // Android emulator reaches the host machine through 10.0.2.2.
    redirectUris: env.PUBLIC_URL
      ? [`${env.PUBLIC_URL.replace(/\/+$/, '')}${CALLBACK_PATH}`]
      : [
          `http://localhost:${port}${CALLBACK_PATH}`,
          `http://10.0.2.2:${port}${CALLBACK_PATH}`,
        ],
  };
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      'Set TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET (see .env.example)'
    );
  }
  if (providerName === 'telegram' && !env.PUBLIC_URL?.startsWith('https://')) {
    throw new Error('PUBLIC_URL must be the public https URL of this server');
  }
  return config;
}

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
  if (!response.ok || body.error) {
    throw new HttpError(
      502,
      body.error ?? 'provider_error',
      body.error_description ??
        body.message ??
        `${what} failed with status ${response.status}`
    );
  }
  return body;
}

/** Verifies signature, issuer, audience and expiry of an RS256 id_token. */
export async function verifyIdToken(idToken, { provider, clientId }) {
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

  const { keys = [] } = await readJson(await fetch(provider.jwksUri), 'JWKS');
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
  if (!valid) {
    throw new HttpError(502, 'invalid_id_token', 'Bad signature');
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== provider.issuer) {
    throw new HttpError(502, 'invalid_id_token', 'Unexpected issuer');
  }
  if (!audiences.includes(clientId)) {
    throw new HttpError(502, 'invalid_id_token', 'Unexpected audience');
  }
  if (
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 < Date.now() - 60_000
  ) {
    throw new HttpError(502, 'invalid_id_token', 'Token expired');
  }
  return claims;
}

function toProfile(claims) {
  return {
    id: String(claims.sub),
    telegramId: claims.id === undefined ? undefined : String(claims.id),
    name: claims.name,
    username: claims.preferred_username,
    picture: claims.picture,
    phoneNumber: claims.phone_number,
  };
}

export async function exchange({ code, redirectUri, codeVerifier }, config) {
  if (typeof code !== 'string' || !code) {
    throw new HttpError(400, 'invalid_request', 'code is required');
  }
  // The verifier proves this request comes from the app instance that
  // started the sign-in, so a stolen code alone is useless.
  if (typeof codeVerifier !== 'string' || !codeVerifier) {
    throw new HttpError(400, 'invalid_request', 'codeVerifier is required');
  }
  // The app does not get to choose where codes are valid.
  if (!config.redirectUris.includes(redirectUri)) {
    throw new HttpError(400, 'invalid_request', 'Unexpected redirectUri');
  }

  const tokens = await readJson(
    await fetch(config.provider.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Telegram authenticates the client with HTTP Basic.
        'Authorization': `Basic ${Buffer.from(
          `${config.clientId}:${config.clientSecret}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier,
      }),
    }),
    'Token request'
  );

  if (!tokens.id_token) {
    throw new HttpError(502, 'invalid_id_token', 'No id_token in the response');
  }
  // Telegram has no userinfo endpoint: the verified id_token is the profile.
  const claims = await verifyIdToken(tokens.id_token, config);

  // A real backend would now create ITS OWN session for this member and
  // return that.
  return {
    profile: toProfile(claims),
    idTokenVerified: true,
    expiresIn: tokens.expires_in,
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
      if (req.method === 'GET' && url.pathname === CALLBACK_PATH) {
        // Bounce: hand the provider's response (code, state or error) to the
        // app. The target is fixed in config, never taken from the request.
        const separator = config.appCallback.includes('?') ? '&' : '?';
        return send(res, 302, undefined, {
          Location: `${config.appCallback}${url.search ? separator + url.search.slice(1) : ''}`,
        });
      }
      if (req.method === 'POST' && url.pathname === '/auth/telegram/exchange') {
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
        return send(res, 200, await exchange(body ?? {}, config));
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, provider: config.providerName });
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
      console.log(
        `[backend] http://localhost:${config.port} (provider: ${config.providerName})`
      );
      console.log(`[backend] redirect URIs: ${config.redirectUris.join(', ')}`);
    }
  );
}
