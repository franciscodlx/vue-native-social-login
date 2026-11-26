// Example backend for @franciscodlxdev/react-native-tiktok-login.
//
// TikTok needs two things a mobile app cannot provide:
//   1. an https redirect URI     → GET  /auth/tiktok/callback forwards
//                                   the browser to the app's own URL scheme
//   2. the client secret at the  → POST /auth/tiktok/exchange swaps the
//      token endpoint              code for tokens and
//                                   returns the user profile
//
// Zero dependencies. PROVIDER=mock (default) talks to examples/mock-idp so the
// whole flow can be tried without a TikTok application.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const CALLBACK_PATH = '/auth/tiktok/callback';
const EXCHANGE_PATH = '/auth/tiktok/exchange';

const PROVIDERS = {
  tiktok: {
    tokenEndpoint: 'https://open.tiktokapis.com/v2/oauth/token/',
    userInfoEndpoint: 'https://open.tiktokapis.com/v2/user/info/',
  },
  mock: {
    tokenEndpoint: 'http://localhost:4000/token',
    userInfoEndpoint: 'http://localhost:4000/v2/user/info/',
  },
};

export function loadConfig(env = process.env) {
  const providerName = env.PROVIDER === 'tiktok' ? 'tiktok' : 'mock';
  const port = Number(env.PORT ?? 4600);
  const mock = providerName === 'mock';
  const config = {
    providerName,
    provider: PROVIDERS[providerName],
    port,
    clientId: env.TIKTOK_CLIENT_KEY || (mock ? 'confidential-app' : ''),
    clientSecret: env.TIKTOK_CLIENT_SECRET || (mock ? 'mock-secret' : ''),
    appCallback: env.APP_CALLBACK || 'tiktokexample://callback',
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
      'Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (see .env.example)'
    );
  }
  if (!mock && !env.PUBLIC_URL?.startsWith('https://')) {
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

const USER_FIELDS = 'open_id,union_id,avatar_url,display_name';

function toProfile(user) {
  return {
    id: user.open_id,
    unionId: user.union_id,
    displayName: user.display_name,
    picture: user.avatar_url,
  };
}

export async function exchange({ code, redirectUri }, config) {
  if (typeof code !== 'string' || !code) {
    throw new HttpError(400, 'invalid_request', 'code is required');
  }
  // The app does not get to choose where codes are valid.
  if (!config.redirectUris.includes(redirectUri)) {
    throw new HttpError(400, 'invalid_request', 'Unexpected redirectUri');
  }

  const tokens = await readJson(
    await fetch(config.provider.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_key: config.clientId,
        client_secret: config.clientSecret,
      }),
    }),
    'Token request'
  );

  // User info wraps the user in `data.user` and always carries an `error`
  // object: only `code: "ok"` means success.
  const response = await fetch(
    `${config.provider.userInfoEndpoint}?fields=${USER_FIELDS}`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const info = await response.json().catch(() => ({}));
  const user = info.data?.user;
  if (!response.ok || info.error?.code !== 'ok' || !user?.open_id) {
    throw new HttpError(
      502,
      info.error?.code ?? 'provider_error',
      info.error?.message ||
        `User request failed with status ${response.status}`
    );
  }
  if (tokens.open_id !== undefined && tokens.open_id !== user.open_id) {
    throw new HttpError(502, 'provider_error', 'User id mismatch');
  }

  // A real backend would now create ITS OWN session for this user, store the
  // TikTok access and refresh tokens server-side, and return only its
  // own session to the app.
  return {
    profile: toProfile(user),
    expiresIn: tokens.expires_in,
    hasRefreshToken: Boolean(tokens.refresh_token),
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
      if (req.method === 'POST' && url.pathname === EXCHANGE_PATH) {
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
