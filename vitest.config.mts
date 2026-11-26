import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against the core's sources, not its build.
      '@franciscodlxdev/vue-native-auth-core': fileURLToPath(
        new URL('./packages/auth-core/src/index.ts', import.meta.url)
      ),
      // The runtime's bridge only exists inside the app; tests swap the
      // platform layer with setNativeForTesting anyway.
      '@thelacanians/vue-native-runtime': fileURLToPath(
        new URL(
          './packages/auth-core/src/__fixtures__/runtime-stub.ts',
          import.meta.url
        )
      ),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
