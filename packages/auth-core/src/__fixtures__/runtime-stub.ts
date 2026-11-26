import { vi } from 'vitest';

/** Stand-in for @thelacanians/vue-native-runtime in unit tests. */
export const NativeBridge = {
  invokeNativeModule: vi.fn<
    (
      moduleName: string,
      method: string,
      args?: unknown[],
      timeoutMs?: number
    ) => Promise<unknown>
  >(),
};
