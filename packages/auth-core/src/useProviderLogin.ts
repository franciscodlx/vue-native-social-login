import {
  getCurrentScope,
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  toValue,
  type DeepReadonly,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import { toAuthError, type AuthError } from './errors';
import type {
  ProviderLogin,
  SignInOptions,
  SignInResult,
  SignOutOptions,
} from './provider';

export interface UseProviderLoginResult<TProfile> {
  /** Resolves with the result, or `null` if it failed (see `error`). */
  signIn(
    overrides?: Partial<SignInOptions>
  ): Promise<SignInResult<TProfile> | null>;
  /** Revokes `options.token` when given, then clears `result` and `error`. */
  signOut(options?: SignOutOptions): Promise<void>;
  loading: DeepReadonly<Ref<boolean>>;
  result: Readonly<ShallowRef<SignInResult<TProfile> | null>>;
  /** Last failure. A user cancellation is reported with code `CANCELLED`. */
  error: Readonly<ShallowRef<AuthError | null>>;
  /** False until the platform check resolves, and on platforms without a system browser session. */
  isAvailable: DeepReadonly<Ref<boolean>>;
}

/**
 * Reactive state around a provider's `signIn` / `signOut`, the Vue
 * counterpart of the React Native `useProviderLogin` hook.
 *
 * `options` may be a plain object, a ref or a getter; it is read on every
 * call, so a ref that changes later is honored.
 */
export function useProviderLogin<TProfile>(
  login: ProviderLogin<TProfile>,
  options: MaybeRefOrGetter<SignInOptions>
): UseProviderLoginResult<TProfile> {
  const loading = ref(false);
  const result = shallowRef<SignInResult<TProfile> | null>(null);
  const error = shallowRef<AuthError | null>(null);
  const isAvailable = ref(false);

  // A sign-in can outlive the component that started it (the browser stays
  // open); once the scope is gone, its state is no longer touched.
  let disposed = false;
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
    });
  }

  login.isAvailable().then(
    (available) => {
      if (!disposed) isAvailable.value = available;
    },
    () => undefined
  );

  async function signIn(
    overrides?: Partial<SignInOptions>
  ): Promise<SignInResult<TProfile> | null> {
    loading.value = true;
    error.value = null;
    result.value = null;
    try {
      const next = await login.signIn({ ...toValue(options), ...overrides });
      if (!disposed) result.value = next;
      return next;
    } catch (e) {
      if (!disposed) error.value = toAuthError(e);
      return null;
    } finally {
      if (!disposed) loading.value = false;
    }
  }

  async function signOut(signOutOptions?: SignOutOptions): Promise<void> {
    await login.signOut({
      clientId: toValue(options).clientId,
      ...signOutOptions,
    });
    if (!disposed) {
      result.value = null;
      error.value = null;
    }
  }

  return {
    signIn,
    signOut,
    loading: readonly(loading),
    result,
    error,
    isAvailable: readonly(isAvailable),
  };
}
