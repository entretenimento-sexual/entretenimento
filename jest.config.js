// jest.config.js
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.spec.json',
      stringifyContentPathRegex: '\\\\.html$',
    },
  },
  transform: {
    '^.+\\\\.(ts|js|html)$': 'ts-jest',
  },
  testEnvironment: 'jsdom',
  testMatch: ['**/+(*.)+(spec).+(ts)'],
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  coverageDirectory: 'coverage',
  // Adicione esta seção para mapeamento de caminhos
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1"
    // Se você usa aliases como "@app/*" no seu tsconfig.json, adicione-os aqui:
    // "^@app/(.*)$": "<rootDir>/src/app/$1"
  },
  // Adicione esta seção para transformar módulos ES de node_modules
  transformIgnorePatterns: [
    'node_modules/(?!.*\\.mjs$|@pqina/angular-pintura)'
  ]
};
