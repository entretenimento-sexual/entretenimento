import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  normalizeFirebaseEmulatorEndpoint,
  requireLocalFirebaseEmulatorEndpoint,
  resolveFirebaseAuthEmulatorPersistenceMode,
  resolveFirebaseAuthEmulatorStartupMode,
} from './firebase-environment.config';
import { environment as emulatorEnvironment } from '../../../environments/environment.dev-emu';


describe('firebase-environment.config', () => {
  it('seleciona o ambiente emulado nas entradas padrão de desenvolvimento', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    const { build, serve } = JSON.parse(readFileSync('angular.json', 'utf8'))
      .projects.entretenimento.architect;
    const commands = ['ng serve', scripts.start, scripts['start:dev'], scripts['start:emu']];

    for (const command of commands) {
      const match = /^ng serve(?: -c ([\w-]+))?$/.exec(command);
      expect(match, command).not.toBeNull();
      const serveConfiguration = match?.[1] ?? serve.defaultConfiguration;
      const buildTarget = serve.configurations[serveConfiguration].buildTarget;
      const environmentReplacement = build.configurations[buildTarget.split(':')[2]].fileReplacements
        ?.find((replacement: { replace: string }) => replacement.replace === 'src/environments/environment.ts');
      expect(environmentReplacement?.with, command).toBe('src/environments/environment.dev-emu.ts');
    }

    expect(emulatorEnvironment.useEmulators).toBe(true);
    for (const service of ['auth', 'firestore', 'functions', 'storage', 'database'] as const) {
      expect(requireLocalFirebaseEmulatorEndpoint(service, emulatorEnvironment.emulators).host).toBe('127.0.0.1');
    }
  });

  it('normaliza endpoint válido do emulator', () => {
    expect(
      normalizeFirebaseEmulatorEndpoint('auth', {
        host: ' 127.0.0.1 ',
        port: 9099,
      })
    ).toEqual({
      host: '127.0.0.1',
      port: 9099,
    });
  });

  it('retorna null quando o serviço não possui endpoint configurado', () => {
    expect(normalizeFirebaseEmulatorEndpoint('storage', undefined)).toBeNull();
  });

  it('rejeita host vazio para evitar conexão ambígua', () => {
    expect(() =>
      normalizeFirebaseEmulatorEndpoint('firestore', {
        host: '   ',
        port: 8080,
      })
    ).toThrowError('Host inválido');
  });

  it('rejeita porta fora do intervalo TCP válido', () => {
    expect(() =>
      normalizeFirebaseEmulatorEndpoint('functions', {
        host: '127.0.0.1',
        port: 70_000,
      })
    ).toThrowError('Porta inválida');
  });

  it('não permite fallback Cloud quando faltar endpoint obrigatório', () => {
    expect(() => requireLocalFirebaseEmulatorEndpoint('auth', undefined))
      .toThrowError('Endpoint obrigatório ausente para auth');
    expect(() => requireLocalFirebaseEmulatorEndpoint('firestore', {
      auth: { host: 'localhost', port: 9099 },
    })).toThrowError('Endpoint obrigatório ausente para firestore');
  });

  it('só aceita loopback para serviços emulados, sem enviar tráfego remoto', () => {
    expect(requireLocalFirebaseEmulatorEndpoint('storage', {
      storage: { host: '127.0.0.1', port: 9199 },
    })).toEqual({ host: '127.0.0.1', port: 9199 });
    expect(() => requireLocalFirebaseEmulatorEndpoint('functions', {
      functions: { host: 'firestore.googleapis.com', port: 443 },
    })).toThrowError('Host não local para functions');
  });

  it('resolve persistência memory e usa session como fallback seguro', () => {
    expect(
      resolveFirebaseAuthEmulatorPersistenceMode({
        getItem: () => ' memory ',
      })
    ).toBe('memory');

    expect(
      resolveFirebaseAuthEmulatorPersistenceMode({
        getItem: () => {
          throw new Error('storage indisponível');
        },
      })
    ).toBe('session');
  });

  it('restaura uma sess?o local existente', () => {
    const key = 'firebase:authUser:fake-api-key:[DEFAULT]';

    expect(resolveFirebaseAuthEmulatorStartupMode(
      'fake-api-key',
      '[DEFAULT]',
      { getItem: candidate =>
          candidate === key ? 'registro-local' : null }
    )).toBe('local');
  });

  it('usa local por padrao mesmo sem sessao anterior', () => {
    expect(resolveFirebaseAuthEmulatorStartupMode(
      'fake-api-key',
      '[DEFAULT]',
      { getItem: () => null }
    )).toBe('local');
  });

  it('preserva isolamento memory explicitamente solicitado', () => {
    expect(resolveFirebaseAuthEmulatorStartupMode(
      'fake-api-key',
      '[DEFAULT]',
      { getItem: key =>
          key === '__EMU_AUTH_PERSIST__' ? 'memory' : 'registro-local' }
    )).toBe('memory');
  });
});
