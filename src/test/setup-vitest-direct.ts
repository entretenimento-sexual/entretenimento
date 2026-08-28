// src/test/setup-vitest-direct.ts
// -----------------------------------------------------------------------------
// DIRECT VITEST ANGULAR SETUP
// -----------------------------------------------------------------------------
//
// Usado apenas quando executamos `npx vitest run --config ...` diretamente.
//
// Motivo:
// - o runner direto não inicializa automaticamente o ambiente Angular TestBed;
// - o builder oficial `ng test` possui seu próprio bootstrap;
// - separar este arquivo evita inicialização duplicada no runner Angular.

import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';

import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
  {
    teardown: {
      destroyAfterEach: true,
    },
  }
);

/**
 * Carrega os mocks e providers globais existentes somente após preparar o
 * ambiente TestBed exigido nos testes executados diretamente pelo Vitest.
 */
import './setup-vitest';