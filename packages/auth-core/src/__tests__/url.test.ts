import { describe, expect, it } from 'vitest';
import {
  appendParams,
  decodeParams,
  encodeParams,
  matchesRedirectUri,
  parseRedirectParams,
} from '../url';

describe('url helpers', () => {
  it('encodes params and skips undefined values', () => {
    expect(encodeParams({ a: '1 2', b: undefined, c: 'x&y' })).toBe(
      'a=1%202&c=x%26y'
    );
  });

  it('appends to endpoints with and without a query string', () => {
    expect(appendParams('https://a.test/auth', { x: '1' })).toBe(
      'https://a.test/auth?x=1'
    );
    expect(appendParams('https://a.test/auth?tenant=t', { x: '1' })).toBe(
      'https://a.test/auth?tenant=t&x=1'
    );
    expect(appendParams('https://a.test/auth', {})).toBe('https://a.test/auth');
  });

  it('decodes plus signs and tolerates malformed escapes', () => {
    expect(decodeParams('a=hello+world&b=%E0%A4%A&c')).toEqual({
      a: 'hello world',
      b: '%E0%A4%A',
      c: '',
    });
  });

  it('reads redirect params from query and fragment', () => {
    expect(
      parseRedirectParams('myapp://callback?code=abc&state=s#id_token=jwt')
    ).toEqual({ code: 'abc', state: 's', id_token: 'jwt' });
  });

  it('matches the redirect URI ignoring query, case of scheme/host and trailing slash', () => {
    expect(
      matchesRedirectUri('myapp://callback?code=1', 'myapp://callback')
    ).toBe(true);
    expect(
      matchesRedirectUri('MyApp://Callback/?code=1', 'myapp://callback')
    ).toBe(true);
    expect(
      matchesRedirectUri(
        'myapp://callback/Other?code=1',
        'myapp://callback/other'
      )
    ).toBe(false);
    expect(
      matchesRedirectUri('HTTPS://App.Test/cb/?code=1', 'https://app.test/cb')
    ).toBe(true);
    expect(matchesRedirectUri('myapp://evil?code=1', 'myapp://callback')).toBe(
      false
    );
    expect(
      matchesRedirectUri('https://app.test.evil.io/cb', 'https://app.test/cb')
    ).toBe(false);
  });
});
