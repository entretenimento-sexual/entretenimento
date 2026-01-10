// jest.config.mjs
export default {
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFiles: [
    // carrega indexedDB fake antes de tudo (para idb-keyval)
    'fake-indexeddb/auto',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup-jest.ts'],
  transform: {
    '^.+\\.(ts|mjs|js)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        diagnostics: { warnOnly: true }
      }
    ],
    '^.+\\.(html|svg)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json' }
    ]
  },

  moduleFileExtensions: ['ts', 'html', 'js', 'json', 'mjs'],
  extensionsToTreatAsEsm: ['.ts'],

  // ⚠️ Importante: permitir transformar libs ESM do node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '@angular' +
      '|rxjs' +
      '|tslib' +
      '|zone\\.js' +
      '|@ngrx' +
      '|@angular/fire' +
      '|firebase' +
      '|@firebase' +
      '|@ng-bootstrap/ng-bootstrap' +
      '|@ngxs/store' +
      '|@pqina/angular-pintura' +
      '|@pqina/pintura' +
    ')/)'
  ],

   // aliases (src/..., @core/..., @shared/...)
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^src/(.*)$': '<rootDir>/src/$1',
  '^@app/(.*)$': '<rootDir>/src/app/$1',
  '^@core/(.*)$': '<rootDir>/src/app/core/$1',
  '^@shared/(.*)$': '<rootDir>/src/app/shared/$1',
  '^@store/(.*)$': '<rootDir>/src/app/store/$1',
  '^@env/(.*)$': '<rootDir>/src/environments/$1',

  // 🟢 Stubs da Pintura
  '^@pqina/angular-pintura$': '<rootDir>/src/test/jest-stubs/angular-pintura.stub.ts',
  '^@pqina/pintura$': '<rootDir>/src/test/jest-stubs/pintura.stub.ts',

  '\\.(css|scss|sass|less)$': 'identity-obj-proxy',
  '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/src/test/jest-stubs/fileMock.js',
},

  testEnvironmentOptions: {
    customExportConditions: ['node', 'jsdom', 'browser', 'es2015'],
  },
};

