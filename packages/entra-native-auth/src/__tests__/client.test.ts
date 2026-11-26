import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveWith,
  jsonResponse,
  createNativeMock,
  type NativeMock,
} from '../../../auth-core/src/__fixtures__/helpers';

import { setNativeForTesting } from '../../../auth-core/src/native';
import { decodeParams } from '../../../auth-core/src/url';
import {
  createEntraNativeAuth,
  type CodeRequiredStep,
  type EntraNativeAuth,
  type EntraStep,
} from '../index';

// The same fake the example app talks to (CommonJS).
const require = createRequire(import.meta.url);
const { createMockEntra } = require('../../../../tools/mock-entra/handler');

const native: NativeMock = createNativeMock();
setNativeForTesting(native);
const BASE = 'https://contoso.ciamlogin.com/contoso.onmicrosoft.com';

let auth: EntraNativeAuth;
let calls: { path: string; form: Record<string, string> }[];

beforeEach(() => {
  const entra = createMockEntra();
  calls = [];
  (globalThis as { fetch: unknown }).fetch = vi.fn(
    async (url: string, init: RequestInit) => {
      const path = url.slice(BASE.length);
      const form = decodeParams(init.body as string);
      calls.push({ path, form });
      const { status, body } = entra.handle(path, form);
      return jsonResponse(body, status);
    }
  );
  auth = createEntraNativeAuth({
    tenantSubdomain: 'contoso',
    clientId: 'mock-entra-client',
    pollTimeoutMs: 5000,
  });
});

function expectStep<T extends EntraStep['type']>(
  step: EntraStep,
  type: T
): Extract<EntraStep, { type: T }> {
  expect(step.type).toBe(type);
  return step as Extract<EntraStep, { type: T }>;
}

describe('sign-in', () => {
  it('email + password: three calls to the tenant URL, then tokens and profile', async () => {
    const step = expectStep(
      await auth.signIn({ username: 'ada@example.com', password: 'Passw0rd!' }),
      'signed_in'
    );
    expect(calls.map((call) => call.path)).toEqual([
      '/oauth2/v2.0/initiate',
      '/oauth2/v2.0/challenge',
      '/oauth2/v2.0/token',
    ]);
    expect(calls[0]!.form).toEqual({
      client_id: 'mock-entra-client',
      username: 'ada@example.com',
      challenge_type: 'password redirect',
    });
    expect(calls[2]!.form).toMatchObject({
      grant_type: 'password',
      password: 'Passw0rd!',
      scope: 'openid offline_access',
    });
    expect(step.tokens.accessToken).toMatch(/^at-/);
    expect(step.tokens.refreshToken).toMatch(/^rt-/);
    expect(step.tokens.profile).toMatchObject({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
  });

  it('a wrong password is a PROVIDER_ERROR with Entra details', async () => {
    await expect(
      auth.signIn({ username: 'ada@example.com', password: 'nope' })
    ).rejects.toMatchObject({
      name: 'EntraAuthError',
      code: 'PROVIDER_ERROR',
      providerError: 'invalid_grant',
      errorCodes: [50126],
      status: 400,
    });
  });

  it('an unknown user is reported as user_not_found', async () => {
    await expect(
      auth.signIn({ username: 'nobody@example.com', password: 'x' })
    ).rejects.toMatchObject({ reason: 'user_not_found' });
  });

  it('email one-time passcode: asks for the code, rejects a wrong one, accepts a resent one', async () => {
    const code = expectStep(
      await auth.signIn({ username: 'otp@example.com' }),
      'code_required'
    );
    expect(code).toMatchObject({
      flow: 'signIn',
      channel: 'email',
      codeLength: 8,
      sentTo: 'o***@e***.com',
    });
    await expect(auth.submitCode(code, '00000000')).rejects.toMatchObject({
      reason: 'invalid_grant:invalid_oob_value',
    });
    // The failed attempt consumed the token: sign in again and resend.
    const again = expectStep(
      await auth.signIn({ username: 'otp@example.com' }),
      'code_required'
    );
    const resent = expectStep(await auth.resendCode(again), 'code_required');
    expect(resent.continuationToken).not.toBe(again.continuationToken);
    expectStep(await auth.submitCode(resent, '12345678'), 'signed_in');
  });

  it('falls back to the browser when a password account is asked for a code', async () => {
    // Offering only `oob` for a password account means "use the browser".
    expectStep(
      await auth.signIn({ username: 'ada@example.com' }),
      'browser_required'
    );
  });

  it('reports the web fallback when Entra answers redirect', async () => {
    expect(
      await auth.signIn({ username: 'sso@example.com', password: 'x' })
    ).toEqual({
      type: 'browser_required',
      flow: 'signIn',
      username: 'sso@example.com',
    });
  });
});

describe('sign-up', () => {
  it('password + attributes up front: code, then signed in', async () => {
    const code = expectStep(
      await auth.signUp({
        username: 'new@example.com',
        password: 'Str0ngPass',
        attributes: { displayName: 'New User' },
      }),
      'code_required'
    );
    expect(calls[0]!.form).toMatchObject({
      challenge_type: 'oob password redirect',
      attributes: '{"displayName":"New User"}',
    });
    const done = expectStep(
      await auth.submitCode(code, '12345678'),
      'signed_in'
    );
    expect(done.tokens.profile).toMatchObject({
      email: 'new@example.com',
      name: 'New User',
    });
    expect(calls.at(-1)!.form.grant_type).toBe('continuation_token');
    // The new account can sign in.
    expectStep(
      await auth.signIn({
        username: 'new@example.com',
        password: 'Str0ngPass',
      }),
      'signed_in'
    );
  });

  it('walks through the steps Entra asks for: code, password, attributes', async () => {
    const code = expectStep(
      await auth.signUp({ username: 'steps@example.com' }),
      'code_required'
    );
    const password = expectStep(
      await auth.submitCode(code, '12345678'),
      'password_required'
    );
    const attributes = expectStep(
      await auth.submitPassword(password, 'Str0ngPass'),
      'attributes_required'
    );
    expect(attributes.requiredAttributes).toEqual([
      { name: 'displayName', type: 'string', required: true },
    ]);
    expectStep(
      await auth.submitAttributes(attributes, { displayName: 'Steps' }),
      'signed_in'
    );
  });

  it('reports an existing account and a weak password', async () => {
    await expect(
      auth.signUp({ username: 'ada@example.com', password: 'Str0ngPass' })
    ).rejects.toMatchObject({ reason: 'user_already_exists' });
    await expect(
      auth.signUp({ username: 'weak@example.com', password: 'short' })
    ).rejects.toMatchObject({ reason: 'invalid_grant:password_too_short' });
  });
});

describe('password reset', () => {
  it('code, new password, poll until done, then signed in with the new password', async () => {
    const code = expectStep(
      await auth.resetPassword({ username: 'ada@example.com' }),
      'code_required'
    );
    const next = expectStep(
      await auth.submitCode(code, '12345678'),
      'new_password_required'
    );
    expectStep(await auth.submitNewPassword(next, 'N3wPassword'), 'signed_in');
    const polls = calls.filter((call) => call.path.endsWith('poll_completion'));
    expect(polls).toHaveLength(2); // in_progress, then succeeded

    await expect(
      auth.signIn({ username: 'ada@example.com', password: 'Passw0rd!' })
    ).rejects.toMatchObject({ providerError: 'invalid_grant' });
    expectStep(
      await auth.signIn({
        username: 'ada@example.com',
        password: 'N3wPassword',
      }),
      'signed_in'
    );
  });

  it('rejects a weak new password', async () => {
    const code = (await auth.resetPassword({
      username: 'ada@example.com',
    })) as CodeRequiredStep;
    const next = expectStep(
      await auth.submitCode(code, '12345678'),
      'new_password_required'
    );
    await expect(auth.submitNewPassword(next, 'short')).rejects.toMatchObject({
      reason: 'invalid_grant:password_too_short',
    });
  });
});

describe('tokens, browser fallback and config', () => {
  it('refreshes with the refresh token', async () => {
    const signedIn = expectStep(
      await auth.signIn({ username: 'ada@example.com', password: 'Passw0rd!' }),
      'signed_in'
    );
    const tokens = await auth.refresh(signedIn.tokens.refreshToken!);
    expect(tokens.accessToken).not.toBe(signedIn.tokens.accessToken);
    expect(calls.at(-1)!.form).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'mock-entra-client',
    });
  });

  it('signInWithBrowser runs code + PKCE against the same tenant', async () => {
    approveWith(native);
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () =>
      jsonResponse({ access_token: 'at-browser', expires_in: 3600 })
    );
    const tokens = await auth.signInWithBrowser({
      redirectUri: 'miapp://callback',
      loginHint: 'sso@example.com',
    });
    const url = native.openAuthSession.mock.calls[0]![0];
    expect(url.startsWith(`${BASE}/oauth2/v2.0/authorize?`)).toBe(true);
    const params = decodeParams(url.slice(url.indexOf('?') + 1));
    expect(params).toMatchObject({
      client_id: 'mock-entra-client',
      login_hint: 'sso@example.com',
      scope: 'openid offline_access',
      code_challenge_method: 'S256',
    });
    expect(tokens.accessToken).toBe('at-browser');
  });

  it('maps network failures and bad config', async () => {
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(
      auth.signIn({ username: 'ada@example.com', password: 'x' })
    ).rejects.toMatchObject({ code: 'NETWORK' });
    expect(() =>
      createEntraNativeAuth({ tenantSubdomain: '', clientId: '' })
    ).toThrow('tenantSubdomain and clientId are required');

    const wrongClient = createEntraNativeAuth({
      tenantSubdomain: 'contoso',
      clientId: 'other',
    });
    const entra = createMockEntra();
    (globalThis as { fetch: unknown }).fetch = vi.fn(
      async (url: string, init: RequestInit) => {
        const { status, body } = entra.handle(
          url.slice(BASE.length),
          decodeParams(init.body as string)
        );
        return jsonResponse(body, status);
      }
    );
    await expect(
      wrongClient.signIn({ username: 'ada@example.com', password: 'x' })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
