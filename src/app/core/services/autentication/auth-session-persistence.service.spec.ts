import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth';
import {
  AuthSessionPersistenceService,
  resolveAuthSessionPersistence,
} from './auth-session-persistence.service';

describe('AuthSessionPersistenceService', () => {
  const persist = vi.fn();

  beforeEach(() => {
    persist.mockReset();
    TestBed.configureTestingModule({
      providers: [
        AuthSessionPersistenceService,
        // Firebase modular setPersistence delega a auth.setPersistence().
        // Este stub testa o mesmo contrato sem modificar o módulo global.
        { provide: Auth, useValue: { setPersistence: persist } },
      ],
    });
  });

  it('mapeia as durações de sessão e o modo do emulador', () => {
    expect(resolveAuthSessionPersistence('local')).toBe(browserLocalPersistence);
    expect(resolveAuthSessionPersistence('session')).toBe(browserSessionPersistence);
    expect(resolveAuthSessionPersistence('none')).toBe(inMemoryPersistence);
    expect(resolveAuthSessionPersistence('local', 'memory')).toBe(inMemoryPersistence);
  });

  it('conclui quando Firebase confirma o modo', async () => {
    persist.mockResolvedValue(undefined);
    await expect(
      firstValueFrom(TestBed.inject(AuthSessionPersistenceService)
        .setSessionPersistence$('session'))
    ).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('falha fechado, sem tentar outro modo de sessão', async () => {
    persist.mockRejectedValue(new Error('storage denied'));
    await expect(
      firstValueFrom(TestBed.inject(AuthSessionPersistenceService)
        .setSessionPersistence$('local'))
    ).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
