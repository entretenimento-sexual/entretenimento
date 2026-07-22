import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserSocialLinksService } from './user-social-links.service';

describe('UserSocialLinksService subscription policy', () => {
  let isSubscriber: boolean;
  let firestoreContextMock: {
    deferPromise$: ReturnType<typeof vi.fn>;
    deferObservable$: ReturnType<typeof vi.fn>;
  };
  let cacheMock: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let globalErrorMock: {
    handleError: ReturnType<typeof vi.fn>;
  };
  let service: UserSocialLinksService;

  beforeEach(() => {
    isSubscriber = false;

    firestoreContextMock = {
      // Os testes deste arquivo validam gates e cache. O callback AngularFire não
      // é executado porque a integração real pertence ao Quality Gate/emulador.
      deferPromise$: vi.fn(() => of(undefined)),
      deferObservable$: vi.fn(() => of(undefined)),
    };

    cacheMock = {
      get: vi.fn(() => of(undefined)),
      set: vi.fn(),
      delete: vi.fn(),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    service = new UserSocialLinksService(
      {} as any,
      firestoreContextMock as any,
      cacheMock as any,
      {
        ready$: of(true),
        authUser$: of({ uid: 'owner-uid' }),
      } as any,
      {
        appUserResolved$: of(true),
        isSubscriber$: of(isSubscriber),
      } as any,
      globalErrorMock as any,
      {
        showError: vi.fn(),
      } as any
    );
  });

  it('bloqueia publicação quando o dono não tem assinatura ativa', async () => {
    await expect(
      firstValueFrom(
        service.saveSocialLinks('owner-uid', {
          instagram: '@perfil',
        })
      )
    ).rejects.toMatchObject({
      code: 'subscription/required',
    });

    expect(firestoreContextMock.deferPromise$).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('permite remoção pelo dono mesmo sem assinatura', async () => {
    await expect(
      firstValueFrom(service.removeLink('owner-uid', 'instagram'))
    ).resolves.toBeUndefined();

    expect(firestoreContextMock.deferPromise$).toHaveBeenCalledTimes(1);
  });

  it('rejeita chave de rede não suportada antes de acessar o Firestore', async () => {
    await expect(
      firstValueFrom(
        service.removeLink('owner-uid', 'rede-inexistente' as any)
      )
    ).rejects.toMatchObject({
      code: 'social-links/invalid-key',
    });

    expect(firestoreContextMock.deferPromise$).not.toHaveBeenCalled();
  });

  it('mantém chaves privadas e públicas separadas', () => {
    const privateKey = (service as any).cacheKey(
      'owner-uid',
      'private'
    );
    const publicKey = (service as any).cacheKey(
      'owner-uid',
      'public'
    );

    expect(privateKey).toBe('socialLinks:private:owner-uid');
    expect(publicKey).toBe('socialLinks:public:owner-uid');
    expect(privateKey).not.toBe(publicKey);
  });

  it('não reutiliza cache na leitura pública', async () => {
    const state = await firstValueFrom(
      (service as any).getCacheState$(
        'owner-uid',
        'public',
        {}
      )
    );

    expect(state).toEqual({ kind: 'miss' });
    expect(cacheMock.get).not.toHaveBeenCalled();
  });
});
