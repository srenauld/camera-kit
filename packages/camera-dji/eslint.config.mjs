import eslintReact from '@eslint-react/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import jest from 'eslint-plugin-jest';
import perfectionist from 'eslint-plugin-perfectionist';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import testingLibrary from 'eslint-plugin-testing-library';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';

const ERROR = 2;
const OFF = 0;

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'e2e/**/*.config.js', 'docs/**', 'eslint.config.mjs', 'src/tests/**', '**/*.test.*'] },
  tseslint.configs.recommended,
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  unicorn.configs.all,
  perfectionist.configs['recommended-alphabetical'],
  importPlugin.flatConfigs.react,
  importPlugin.flatConfigs['react-native'],
  importPlugin.flatConfigs.typescript,
  react.configs.flat.all,
  react.configs.flat['jsx-runtime'],
  reactRefresh.configs.recommended,
  testingLibrary.configs['flat/react'],
  eslintReact.configs['recommended-typescript'],
  eslintConfigPrettier, // last
  {
    languageOptions: {
      globals: {
        __DEV__: 'readonly', // define it as a global variable
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        node: true,
        typescript: true,
      },
      perfectionist: {
        partitionByComment: true,
        type: 'alphabetical',
      },
      react: {
        version: '19.2',
      },
    },
  },
  {
    ...reactHooks.configs.recommended,
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@eslint-react/naming-convention-ref-name': OFF,
      '@eslint-react/no-context-provider': OFF,
      '@eslint-react/no-unnecessary-use-prefix': OFF,
      '@eslint-react/no-use-context': OFF,
      '@eslint-react/set-state-in-effect': [ERROR],
      '@typescript-eslint/consistent-type-definitions': [ERROR, 'type'],
      '@typescript-eslint/dot-notation': [ERROR, { allowKeywords: true }],
      '@typescript-eslint/no-empty-function': OFF,
      '@typescript-eslint/no-unused-vars': [
        ERROR,
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^React$',
        },
      ],
      '@typescript-eslint/no-useless-default-assignment': OFF,
      '@typescript-eslint/require-await': OFF,
      '@typescript-eslint/restrict-template-expressions': OFF,
      'import/no-unresolved': OFF, // handled by TypeScript
      'max-classes-per-file': [ERROR, 1],
      'no-console': [ERROR, { allow: ['warn', 'error'] }],
      'no-magic-numbers': [
        ERROR,
        {
          ignore: [-1, 0, 1, 2, 3, 4, 5, 6],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
        },
      ],
      'perfectionist/sort-imports': [
        'error',
        {
          customGroups: [
            {
              elementNamePattern: '@/components(/.+)?',
              groupName: 'components',
            },
            {
              elementNamePattern: '@/hooks(/.+)?',
              groupName: 'hooks',
            },
            {
              elementNamePattern: '@/navigation(/.+)?',
              groupName: 'navigation',
            },
            {
              elementNamePattern: '@/screens(/.+)?',
              groupName: 'screens',
            },
            {
              elementNamePattern: '@/test(/.+)?',
              groupName: 'test',
            },
            {
              elementNamePattern: '@/theme(/.+)?',
              groupName: 'theme',
            },
            {
              elementNamePattern: '@/translations(/.+)?',
              groupName: 'translations',
            },
          ],
          groups: [
            'side-effect',
            ['type', 'type-internal'],
            ['builtin', 'external'],
            ['theme', 'hooks', 'navigation', 'translations'],
            ['components', 'screens'],
            ['test'],
            'internal',
            'unknown',
          ],
          newlinesBetween: 1,
          type: 'alphabetical',
        },
      ],

      'react-refresh/only-export-components': OFF,
      'react/forbid-component-props': OFF,
      'react/jsx-filename-extension': [ERROR, { extensions: ['.tsx', '.jsx'] }],
      'react/jsx-max-depth': [ERROR, { max: 10 }],
      'react/jsx-no-bind': OFF,
      'react/jsx-no-literals': OFF,
      'react/jsx-props-no-spreading': OFF,
      'react/jsx-sort-props': OFF, // Handled by perfectionist
      'react/no-multi-comp': [ERROR, { ignoreStateless: false }],
      'react/no-unescaped-entities': OFF,
      'react/require-default-props': OFF,
      'unicorn/filename-case': OFF,
      'unicorn/no-array-callback-reference': OFF,
      'unicorn/no-array-reduce': OFF,
      'unicorn/no-array-sort': OFF,
      'unicorn/no-keyword-prefix': OFF,
      'unicorn/no-null': OFF,
      'unicorn/no-useless-undefined': OFF,
      'unicorn/prefer-event-target': OFF,
      'unicorn/prefer-top-level-await': 0, // not valid on RN for the moment
      'unicorn/prevent-abbreviations': [
        ERROR,
        {
          allowList: {
            env: true,
            Param: true,
            props: true,
            Props: true,
          },
        },
      ],
    },
  },
  {
    files: ['src/ble.ts'],
    rules: {
      'max-classes-per-file': OFF,
    },
  },
  {
    files: ['**/theme/*.ts'],
    rules: {
      'no-magic-numbers': OFF,
    },
  },
  {
    files: ['src/shared/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        ERROR,
        {
          patterns: [
            {
              group: [
                '@/config/**',
                '@/features/**',
                '@/hooks/**',
                '@/navigation/**',
                '@/screens/**',
                '@/services/**',
              ],
              message:
                'Shared UI must be props-only and cannot depend on app or feature orchestration.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        ERROR,
        {
          patterns: [
            {
              group: [
                '@/app/**',
                '@/entities/**',
                '@/features/**',
                '@/hooks/**',
                '@/pages/**',
                '@/ride/**',
                '@/screens/**',
                '@/services/**',
              ],
              message: 'Shared may not depend on domain or application layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/entities/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        ERROR,
        {
          patterns: [
            {
              group: [
                '@/app/**',
                '@/features/**',
                '@/hooks/**',
                '@/pages/**',
                '@/ride/**',
                '@/screens/**',
                '@/services/**',
              ],
              message: 'Entities may only depend on shared code and their own slice.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        ERROR,
        {
          patterns: [
            {
              group: ['@/app/**', '@/pages/**', '@/screens/**'],
              message: 'Features may not depend on pages or app composition.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.tsx', '**/fixtures/**/*.{ts,tsx}', '**/*Fixtures.{ts,tsx}'],
    rules: {
      'no-magic-numbers': OFF,
    },
  },
  {
    files: [
      '*.conf.{cjs,js}',
      '*.config.{cjs,js}',
      '*.setup.{cjs,js}',
      'babel.config.{cjs,js}',
      'jest.config.{cjs,js}',
      'metro.config.{cjs,js}',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': OFF,
      '@typescript-eslint/no-unsafe-assignment': OFF,
      '@typescript-eslint/no-unsafe-call': OFF,
      '@typescript-eslint/no-unsafe-member-access': OFF,
      'no-undef': OFF,
      'unicorn/prefer-module': OFF,
    },
  },
  {
    files: [
      'src/App.tsx',
      'src/components/animations/ArcheryLoad.tsx',
      'src/config/appConfig.tsx',
      'src/config/ConfigProvider.tsx',
      'src/config/featureFlags.ts',
      'src/repositories/sessionRepository.ts',
      'src/sensors/sensorDiagnostics.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': OFF,
      '@typescript-eslint/no-unsafe-member-access': OFF,
    },
  },
  {
    files: ['**/*.spec.{js,ts,jsx,tsx}', '**/*.test.{js,ts,jsx,tsx}'],
    ...jest.configs['flat/recommended'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      '@typescript-eslint/no-misused-spread': OFF,
      '@typescript-eslint/no-require-imports': OFF,
      '@typescript-eslint/no-unsafe-assignment': OFF,
      '@typescript-eslint/no-unsafe-member-access': OFF,
      '@typescript-eslint/require-await': OFF,
      '@typescript-eslint/unbound-method': OFF,
      'no-magic-numbers': OFF,
      'testing-library/prefer-screen-queries': OFF,
      'testing-library/render-result-naming-convention': OFF,
      'unicorn/prefer-code-point': OFF,
    },
  },
  {
    files: ['**/*.stories.{js,ts,jsx,tsx}'],
    rules: {
      '@typescript-eslint/no-misused-spread': OFF,
      '@typescript-eslint/no-unsafe-assignment': OFF,
    },
  },
  {
    files: [
      'src/sensors/analysis/**/*.{ts,tsx}',
      'src/sensors/quiver/**/*.{ts,tsx}',
      'src/sensors/mantis/**/*.{ts,tsx}',
    ],
    rules: {
      'no-magic-numbers': OFF,
    },
  },
  {
    ignores: ['.rnstorybook/**', 'coverage/**', 'plugins/**'],
  },
  {
    ignores: [
      'src/components/Chip.tsx',
      'src/components/DefaultError.tsx',
      'src/components/ErrorBoundary.tsx',
      'src/components/ListingCard.tsx',
      'src/components/SafeScreen.tsx',
      'src/screens/Noticeboard/**',
      'src/screens/Startup/LoginButton.tsx',
      'src/tests/TestAppWrapper.tsx',
    ],
  },
);
