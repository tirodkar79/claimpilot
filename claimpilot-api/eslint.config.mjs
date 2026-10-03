import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import sonarjs from 'eslint-plugin-sonarjs';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Mirrors the core-data-layer ESLint setup, in flat-config form (ESLint 10 dropped .eslintrc).
export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**', '**/*.spec.ts', '**/*.e2e-spec.ts', 'eslint.config.mjs'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,
    prettierRecommended,
    {
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
        plugins: { 'unused-imports': unusedImports },
        rules: {
            'no-underscore-dangle': 'off',
            'no-continue': 'off',
            'no-shadow': 'warn',
            'default-case': 'warn',
            'no-console': 'error',
            camelcase: 'error',
            'no-param-reassign': 'warn',
            'consistent-return': 'off',
            'prettier/prettier': 'error',
            '@typescript-eslint/explicit-member-accessibility': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            'unused-imports/no-unused-imports': 'error',
        },
    },
);
