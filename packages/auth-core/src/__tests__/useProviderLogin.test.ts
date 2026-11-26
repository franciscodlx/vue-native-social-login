import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  AuthError,
  type ProviderLogin,
  type SignInResult,
} from '../index';
import { useProviderLogin } from '../useProviderLogin';

const RESULT: SignInResult = {
  code: 'the-code',
  state: 'the-state',
  redirectUri: 'myapp://callback',
  params: {},
  accessToken: 'token',
};

function fakeLogin(overrides: Partial<ProviderLogin> = {}): ProviderLogin {
  return {
    provider: {
      id: 'fake',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      defaultScopes: [],
    },
    signIn: vi.fn().mockResolvedValue(RESULT),
    signOut: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const OPTIONS = { clientId: 'client', redirectUri: 'myapp://callback' };

describe('useProviderLogin', () => {
  it('exposes loading while signing in, then the result', async () => {
    const pending = deferred<SignInResult>();
    const login = fakeLogin({ signIn: vi.fn(() => pending.promise) });
    const state = useProviderLogin(login, OPTIONS);

    const call = state.signIn();
    expect(state.loading.value).toBe(true);
    pending.resolve(RESULT);

    await expect(call).resolves.toBe(RESULT);
    expect(state.loading.value).toBe(false);
    expect(state.result.value).toBe(RESULT);
    expect(state.error.value).toBeNull();
  });

  it('turns a failure into an AuthError and resolves with null', async () => {
    const login = fakeLogin({
      signIn: vi.fn().mockRejectedValue(new AuthError('CANCELLED', 'closed')),
    });
    const state = useProviderLogin(login, OPTIONS);

    await expect(state.signIn()).resolves.toBeNull();
    expect(state.error.value?.code).toBe('CANCELLED');
    expect(state.result.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it('normalizes errors that are not AuthError', async () => {
    const login = fakeLogin({
      signIn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const state = useProviderLogin(login, OPTIONS);

    await state.signIn();
    expect(state.error.value).toBeInstanceOf(AuthError);
  });

  it('reads ref options on every call and merges the overrides', async () => {
    const login = fakeLogin();
    const options = ref({ ...OPTIONS });
    const state = useProviderLogin(login, options);

    options.value = { ...OPTIONS, clientId: 'changed' };
    await state.signIn({ scopes: ['openid'] });

    expect(login.signIn).toHaveBeenCalledWith({
      clientId: 'changed',
      redirectUri: 'myapp://callback',
      scopes: ['openid'],
    });
  });

  it('accepts a getter as options', async () => {
    const login = fakeLogin();
    const state = useProviderLogin(login, () => OPTIONS);

    await state.signIn();
    expect(login.signIn).toHaveBeenCalledWith(OPTIONS);
  });

  it('signs out with the client id and clears the state', async () => {
    const login = fakeLogin();
    const state = useProviderLogin(login, OPTIONS);
    await state.signIn();

    await state.signOut({ token: 'token' });

    expect(login.signOut).toHaveBeenCalledWith({
      clientId: 'client',
      token: 'token',
    });
    expect(state.result.value).toBeNull();
  });

  it('reports isAvailable once the platform check resolves', async () => {
    const state = useProviderLogin(fakeLogin(), OPTIONS);
    expect(state.isAvailable.value).toBe(false);

    await nextTick();
    expect(state.isAvailable.value).toBe(true);
  });

  it('stops touching state once its scope is disposed', async () => {
    const pending = deferred<SignInResult>();
    const login = fakeLogin({ signIn: vi.fn(() => pending.promise) });
    const scope = effectScope();
    const state = scope.run(() => useProviderLogin(login, OPTIONS))!;

    const call = state.signIn();
    scope.stop();
    pending.resolve(RESULT);

    await expect(call).resolves.toBe(RESULT);
    expect(state.result.value).toBeNull();
    expect(state.loading.value).toBe(true);
  });
});
