import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/android/**',
      '**/ios/**',
      'tools/**',
      // Written by vue-native's codegen and scripts/vendor-native.mjs.
      'examples/*/app/generated/**',
      'examples/*/native/**',
      'examples/*/scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Node CLI shipped in the core package (npx vue-native-social-login setup).
    files: ['packages/*/bin/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  }
);
