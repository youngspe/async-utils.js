import { defineConfig, globalIgnores } from '@eslint/config-helpers';
import jseslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-plugin-prettier/recommended';

export default defineConfig(
  globalIgnores(['**/dist']),
  jseslint.configs.recommended,
  prettierConfig,
  {
    extends: [tseslint.configs.eslintRecommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
  },
  {
    rules: {
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': ['error', { allowForKnownSafeCalls: ['suite', 'test'] }],
      '@typescript-eslint/prefer-promise-reject-errors': [
        'off',
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
      '@typescript-eslint/require-await': 'off',
      'no-useless-assignment': 'off',
    },
  },
);
