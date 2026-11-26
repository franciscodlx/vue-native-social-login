import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import {
  createPresetLogin,
  discordLogin,
  githubLogin,
  mapDiscordProfile,
  mapGitHubProfile,
  mapSlackProfile,
  mapStravaProfile,
  presets,
  slackLogin,
  stravaLogin,
} from '../index';

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const fetchMock = vi.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const options = {
  clientId: 'client-1',
  redirectUri: 'https://api.miapp.com/auth/x/callback',
  callbackUri: 'miapp://callback',
};

function sent() {
  const url = native.openAuthSession.mock.calls[0]![0];
  const [endpoint, query = ''] = url.split('?');
  return { endpoint, params: decodeParams(query) };
}

beforeEach(() => {
  native.openAuthSession.mockReset();
  fetchMock.mockReset();
});

describe('authorization requests', () => {
  it('github: space-separated scopes with PKCE', async () => {
    approveWith(native);
    const result = await githubLogin.signIn(options);
    const { endpoint, params } = sent();
    expect(endpoint).toBe('https://github.com/login/oauth/authorize');
    expect(params.scope).toBe('read:user user:email');
    expect(params.code_challenge_method).toBe('S256');
    expect(params.nonce).toBeUndefined();
    expect(result.codeVerifier).toBeTruthy();
  });

  it('discord: identify + email with PKCE', async () => {
    approveWith(native);
    await discordLogin.signIn(options);
    const { endpoint, params } = sent();
    expect(endpoint).toBe('https://discord.com/oauth2/authorize');
    expect(params.scope).toBe('identify email');
    expect(params.code_challenge).toBeTruthy();
  });

  it('slack: OpenID Connect with nonce, without PKCE', async () => {
    approveWith(native);
    const result = await slackLogin.signIn(options);
    const { endpoint, params } = sent();
    expect(endpoint).toBe('https://slack.com/openid/connect/authorize');
    expect(params.scope).toBe('openid profile email');
    expect(params.nonce).toBe(result.nonce);
    expect(params.code_challenge).toBeUndefined();
    expect(result.codeVerifier).toBeUndefined();
  });

  it('strava: mobile endpoint, comma-separated scopes, approval_prompt', async () => {
    approveWith(native);
    await stravaLogin.signIn({ ...options, scopes: ['read', 'activity:read'] });
    const { endpoint, params } = sent();
    expect(endpoint).toBe('https://www.strava.com/oauth/mobile/authorize');
    expect(params.scope).toBe('read,activity:read');
    expect(params.approval_prompt).toBe('auto');
    expect(params.code_challenge).toBeUndefined();
  });
});

describe('shared behaviour', () => {
  it.each(Object.keys(presets))(
    '%s: returns the code for the backend, never exchanges on-device',
    async (name) => {
      const login = createPresetLogin(name as keyof typeof presets);
      approveWith(native);
      const result = await login.signIn(options);
      expect(result.code).toBe('the-code');
      expect(result.accessToken).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(
        login.signIn({ ...options, exchangeCode: true })
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    }
  );

  it('reports a denial as CANCELLED', async () => {
    approveWith(native, { error: 'access_denied' });
    await expect(stravaLogin.signIn(options)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('discord: accepts its own issuer and rejects a foreign one (RFC 9207)', async () => {
    approveWith(native, { code: 'the-code', iss: 'https://discord.com' });
    await expect(discordLogin.signIn(options)).resolves.toMatchObject({
      code: 'the-code',
    });
    approveWith(native, { code: 'the-code', iss: 'https://evil.test' });
    await expect(discordLogin.signIn(options)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('accepts overrides and rejects an unknown preset', async () => {
    approveWith(native);
    await createPresetLogin('github', {
      authorizationEndpoint: 'http://localhost:4000/authorize',
      defaultScopes: ['read:user'],
    }).signIn(options);
    expect(sent().endpoint).toBe('http://localhost:4000/authorize');
    expect(sent().params.scope).toBe('read:user');
    expect(() => createPresetLogin('gitlab' as never)).toThrow(
      'Unknown preset'
    );
  });
});

describe('profile mappers', () => {
  it('github', () => {
    expect(
      mapGitHubProfile({
        id: 1,
        login: 'octocat',
        name: 'The Octocat',
        email: null,
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
      })
    ).toMatchObject({
      id: '1',
      username: 'octocat',
      name: 'The Octocat',
      email: undefined,
      picture: 'https://avatars.githubusercontent.com/u/1',
    });
  });

  it('discord builds the avatar URL', () => {
    expect(
      mapDiscordProfile({
        id: '80351110224678912',
        username: 'nelly',
        global_name: 'Nelly',
        avatar: '8342729096ea3675442027381ff50dfe',
        email: 'nelly@discord.com',
        verified: true,
      })
    ).toMatchObject({
      id: '80351110224678912',
      username: 'nelly',
      name: 'Nelly',
      email: 'nelly@discord.com',
      emailVerified: true,
      picture:
        'https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png',
    });
    expect(
      mapDiscordProfile({ id: '1', avatar: null }).picture
    ).toBeUndefined();
  });

  it('slack', () => {
    expect(
      mapSlackProfile({
        sub: 'U123',
        name: 'Ada',
        email: 'ada@example.com',
        email_verified: true,
        picture: 'https://secure.gravatar.com/a.jpg',
      })
    ).toMatchObject({ id: 'U123', name: 'Ada', emailVerified: true });
  });

  it('strava', () => {
    expect(
      mapStravaProfile({
        id: 227615,
        username: 'ada',
        firstname: 'Ada',
        lastname: 'Lovelace',
        profile: 'https://dgalywyr863hv.cloudfront.net/large.jpg',
      })
    ).toMatchObject({
      id: '227615',
      username: 'ada',
      name: 'Ada Lovelace',
      picture: 'https://dgalywyr863hv.cloudfront.net/large.jpg',
    });
  });
});
