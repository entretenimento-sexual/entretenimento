import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PublicProfileReadBoundaryService,
  type PublicProfileReadResponse,
} from './public-profile-read-boundary.service';

// AngularFire expõe wrappers que podem ter sido vinculados antes do
// vi.mock. Substituímos apenas a callable privada da instância testada,
// sem simular um objeto Functions inválido nem fazer chamadas de rede.
const callable = vi.fn();

const page = (uid = 'allowed-owner'): PublicProfileReadResponse => ({
  items: [{ uid, nickname: 'Perfil público' }],
  nextCursor: null,
  reachedEnd: true,
  fetchedAt: 1,
  scanned: 1,
});

describe('PublicProfileReadBoundaryService: proteção de quota por sessão', () => {
  let auth: { currentUser: { uid: string } | null };
  let service: PublicProfileReadBoundaryService;

  beforeEach(() => {
    callable.mockReset();
    auth = { currentUser: { uid: 'viewer-a' } };
    TestBed.configureTestingModule({
      providers: [
        PublicProfileReadBoundaryService,
        { provide: Auth, useValue: auth },
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(PublicProfileReadBoundaryService);
    // O field readonly de TypeScript é propriedade de instância em runtime.
    // Evita dependência da resolução de módulos AngularFire no Vitest.
    if (!Reflect.set(service, 'getPublicProfilesPageCallable', callable)) {
      throw new Error('Não foi possível substituir a Callable no teste');
    }
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('compartilha um único POST simultâneo sem manter resultado após conclusão', async () => {
    let complete!: (value: { data: PublicProfileReadResponse }) => void;
    callable.mockImplementation(() => new Promise((resolve) => {
      complete = resolve;
    }));

    const request = { uids: ['owner-1'] };
    const first = firstValueFrom(service.read$(request));
    const second = firstValueFrom(service.read$(request));
    expect(callable).toHaveBeenCalledTimes(1);

    complete({ data: page('owner-1') });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(page('owner-1'));
    expect(b).toEqual(page('owner-1'));

    callable.mockResolvedValueOnce({ data: page('owner-1') });
    await firstValueFrom(service.read$(request));
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('respeita retryAfter do servidor e impede novas chamadas do mesmo UID', async () => {
    const quotaError = Object.assign(new Error('Muitas consultas'), {
      code: 'functions/resource-exhausted',
      details: { retryAfterMs: 45_000 },
    });
    callable.mockRejectedValueOnce(quotaError);

    await expect(firstValueFrom(service.read$({ uids: ['a'] })))
      .rejects.toBe(quotaError);
    await expect(firstValueFrom(service.read$({ mode: 'all', pageSize: 24 })))
      .rejects.toBe(quotaError);
    expect(callable).toHaveBeenCalledTimes(1);

    // Um novo usuário nunca herda a quota local da sessão anterior.
    auth.currentUser = { uid: 'viewer-b' };
    callable.mockResolvedValueOnce({ data: page('b') });
    await expect(firstValueFrom(service.read$({ uids: ['b'] })))
      .resolves.toEqual(page('b'));
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('revalida no backend após vencimento da quota sem usar resultados antigos', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const quotaError = Object.assign(new Error('Muitas consultas'), {
      code: 'functions/resource-exhausted',
      details: { retryAfterMs: 5_000 },
    });
    callable.mockRejectedValueOnce(quotaError);
    await expect(firstValueFrom(service.read$({ uids: ['a'] })))
      .rejects.toBe(quotaError);

    clock.mockReturnValue(1_005_001);
    callable.mockResolvedValueOnce({ data: page('a') });
    await expect(firstValueFrom(service.read$({ uids: ['a'] })))
      .resolves.toEqual(page('a'));
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('não converte outros erros de segurança em cooldown', async () => {
    const denied = Object.assign(new Error('Permissão negada'), {
      code: 'functions/permission-denied',
    });
    callable.mockRejectedValueOnce(denied);
    callable.mockResolvedValueOnce({ data: page() });
    await expect(firstValueFrom(service.read$({ uids: ['a'] })))
      .rejects.toBe(denied);
    await expect(firstValueFrom(service.read$({ uids: ['a'] })))
      .resolves.toEqual(page());
    expect(callable).toHaveBeenCalledTimes(2);
  });
});
