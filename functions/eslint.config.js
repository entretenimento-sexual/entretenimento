// functions/eslint.config.js  (CommonJS, compatível com Node 22)
const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    files: ['src/**/*.ts'],
    ignores: ['lib/**', 'node_modules/**'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.dev.json'],
        tsconfigRootDir: __dirname,
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Base recomendada JavaScript.
      ...js.configs.recommended.rules,

      // A regra core não interpreta corretamente contratos e parâmetros TS.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      'no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],

      quotes: [
        'error',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      indent: ['error', 2],
      'max-len': ['error', { code: 120 }],
      'linebreak-style': 'off',
      'no-undef': 'off',
    },
  },
  {
    // Estes contratos removem deliberadamente faixas Unicode de controle.
    // A exceção permanece limitada aos sanitizadores explícitos e testados.
    files: [
      'src/account_lifecycle/_shared.ts',
      'src/community/community-feed.model.ts',
      'src/community/community-membership-management.handler.ts',
      'src/community/community-preview.model.ts',
      'src/community/community-user-index.projection.ts',
    ],
    rules: {
      'no-control-regex': 'off',
    },
  },
];
