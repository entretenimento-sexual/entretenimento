import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
} from 'firebase/auth';
import {
  AuthSessionPersistenceService,
  resolveAuthSessionPersistence,
} from './auth-session-persistence.service';

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  setPersistence: vi.fn(),
}));

describe('AuthSessionPersistenceService', () => {
  beforeEach(() => {
    vi.mocked(setPersistence).mockReset();
    TestBed.configureTestingModule({
      providers: [
        AuthSessionPersistenceService,
        { provide: Auth, useValue: {} },
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
    vi.mocked(setPersistence).mockResolvedValue(undefined);
    await expect(
      firstValueFrom(TestBed.inject(AuthSessionPersistenceService)
        .setSessionPersistence$('session'))
    ).resolves.toBeUndefined();
    expect(setPersistence).toHaveBeenCalledTimes(1);
  });

  it('falha fechado, sem tentar outro modo de sessão', async () => {
    vi.mocked(setPersistence).mockRejectedValue(new Error('storage denied'));
    await expect(
      firstValueFrom(TestBed.inject(AuthSessionPersistenceService)
        .setSessionPersistence$('local'))
    ).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
    expect(setPersistence).toHaveBeenCalledTimes(1);
  });
});
