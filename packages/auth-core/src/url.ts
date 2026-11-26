// Hand-rolled on purpose: custom-scheme URLs (myapp://callback) parse
// differently across WebViews, so URL is not relied on.

export type Params = Record<string, string>;

export function encodeParams(
  params: Record<string, string | undefined>
): string {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined)
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(params[key] as string)}`
    )
    .join('&');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export function decodeParams(query: string): Params {
  const out: Params = {};
  for (const pair of query.split('&')) {
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf('=');
    const key = safeDecode(eq === -1 ? pair : pair.slice(0, eq));
    out[key] = eq === -1 ? '' : safeDecode(pair.slice(eq + 1));
  }
  return out;
}

/** Appends `params` to `endpoint`, keeping any query string it already has. */
export function appendParams(
  endpoint: string,
  params: Record<string, string | undefined>
): string {
  const query = encodeParams(params);
  if (!query) {
    return endpoint;
  }
  const hashAt = endpoint.indexOf('#');
  const base = hashAt === -1 ? endpoint : endpoint.slice(0, hashAt);
  const separator = !base.includes('?')
    ? '?'
    : base.endsWith('?') || base.endsWith('&')
      ? ''
      : '&';
  return `${base}${separator}${query}`;
}

/** Query and fragment parameters of a redirect URL (query wins on conflict). */
export function parseRedirectParams(url: string): Params {
  const hashAt = url.indexOf('#');
  const fragment = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const withoutFragment = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = withoutFragment.indexOf('?');
  const query = queryAt === -1 ? '' : withoutFragment.slice(queryAt + 1);
  return { ...decodeParams(fragment), ...decodeParams(query) };
}

/** `scheme://host/path` of a URL, without query or fragment, scheme and host lowercased. */
export function stripQueryAndFragment(url: string): string {
  const cut = url.search(/[?#]/);
  const base = cut === -1 ? url : url.slice(0, cut);
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/[^/]*)?(.*)$/.exec(base);
  if (!match) {
    return base;
  }
  const [, scheme = '', authority = '', path = ''] = match;
  return `${scheme.toLowerCase()}:${authority.toLowerCase()}${path}`;
}

/** Whether `url` is a redirect to `redirectUri` (same scheme, host and path). */
export function matchesRedirectUri(url: string, redirectUri: string): boolean {
  const normalize = (value: string) =>
    stripQueryAndFragment(value).replace(/\/+$/, '');
  return normalize(url) === normalize(redirectUri);
}

export function getScheme(url: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  return match?.[1]?.toLowerCase();
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'];

/**
 * https, or plain http to a loopback host (`10.0.2.2` is the Android
 * emulator's alias for the host machine) so a local test server can be used.
 */
export function isSecureEndpoint(url: string): boolean {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
  if (!match) {
    return false;
  }
  if (match[1]?.toLowerCase() === 'https') {
    return true;
  }
  const host = (match[2] ?? '')
    .slice((match[2] ?? '').lastIndexOf('@') + 1)
    .replace(/:\d+$/, '')
    .toLowerCase();
  return LOOPBACK_HOSTS.includes(host);
}
