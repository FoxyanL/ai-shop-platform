import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/admin/src/**/*.{ts,tsx}', 'apps/storefront/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'apps/storefront/src/app/api/**/*.ts',
      'apps/storefront/src/app/api/**/*.tsx',
      'services/api/{src,tests}/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'services/api/{src,tests}/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
