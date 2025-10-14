// functions/eslint.config.js  (CommonJS, compatível com Node 18)
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
    // NÃO registramos o plugin @typescript-eslint aqui
    rules: {
      // Base recomendada JS
      ...js.configs.recommended.rules,

      // Use a regra CORE (não a do plugin) com opções explícitas
      "no-unused-expressions": ["error", {
        allowShortCircuit: true,
        allowTernary: true,
        allowTaggedTemplates: true,
      }],

      // Estilo
      "quotes": ["error", "double"],
      "indent": ["error", 2],
      "max-len": ["error", { code: 120 }],
      "linebreak-style": "off",
      "no-undef": "off", // evita falsos-positivos com tipos TS
    },
  },
];
