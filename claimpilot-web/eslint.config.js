import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import sonarjs from 'eslint-plugin-sonarjs';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Same rule set as claimpilot-api (core-data-layer conventions) plus the React hooks/refresh rules.
export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**', '**/*.test.ts', '**/*.test.tsx'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite,
    prettierRecommended,
    {
        languageOptions: { globals: globals.browser },
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
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            'unused-imports/no-unused-imports': 'error',
        },
    },
);
