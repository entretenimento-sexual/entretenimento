// functions/eslint.config.js  (CommonJS, compatível com Node 22)
const js = require("@eslint/js");

module.exports = [
  {
    files: ["src/**/*.ts"],
    ignores: ["lib/**", "node_modules/**"],
    languageOptions: {
      parser: require("@typescript-eslint/parser"),
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.dev.json"],
        tsconfigRootDir: __dirname,
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    rules: {
      // Base recomendada JS.
      ...js.configs.recommended.rules,

      // Usa a regra core com opções explícitas; o plugin TS não é necessário.
      "no-unused-expressions": ["error", {
        allowShortCircuit: true,
        allowTernary: true,
        allowTaggedTemplates: true,
      }],

      // Estilo.
      "quotes": ["error", "single", {
        avoidEscape: true,
        allowTemplateLiterals: true,
      }],
      "indent": ["error", 2],
      "max-len": ["error", { code: 120 }],
      "linebreak-style": "off",
      "no-undef": "off", // Evita falsos positivos com tipos TypeScript.
    },
  },
];
