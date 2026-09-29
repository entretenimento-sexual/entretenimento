// src/app/core/services/user-profile/profile-completion.service.spec.ts
import { describe, expect, it } from 'vitest';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ProfileCompletionService } from './profile-completion.service';

describe('ProfileCompletionService', () => {
  const service = new ProfileCompletionService();

  it('gera a rota canônica de upload para a pendência de foto', () => {
    const checklist = service.buildChecklist({
      uid: 'user-1',
      photoURL: null,
    } as IUserDados);
    const photoItem = checklist.items.find((item) => item.id === 'photo');

    expect(photoItem?.completed).toBe(false);
    expect(photoItem?.routerLink).toEqual([
      '/media',
      'perfil',
      'user-1',
      'fotos',
      'upload',
    ]);
  });

  it('considera maioridade concluída pela projeção canônica sem exigir user.idade', () => {
    const checklist = service.buildChecklist({
      uid: 'user-1',
      idade: undefined,
      ageEligibility: {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        caseId: null,
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    } as IUserDados);
    const ageItem = checklist.items.find((item) => item.id === 'age');

    expect(ageItem?.completed).toBe(true);
    expect(ageItem?.actionLabel).toBe('Confirmar maioridade');
    expect(ageItem?.routerLink).toEqual(['/adulto', 'verificar-idade']);
  });

  it('não aceita idade legada como substituta da autoridade etária', () => {
    const checklist = service.buildChecklist({
      uid: 'user-1',
      idade: 35,
      ageEligibility: null,
    } as IUserDados);
    const ageItem = checklist.items.find((item) => item.id === 'age');

    expect(ageItem?.completed).toBe(false);
  });

  it('considera projeção etária vencida como pendência real', () => {
    const now = Date.now();
    const checklist = service.buildChecklist({
      uid: 'user-1',
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: now - 10_000,
        expiresAtMs: now - 1,
        updatedAtMs: now - 10_000,
      },
    } as IUserDados);
    const ageItem = checklist.items.find((item) => item.id === 'age');

    expect(ageItem?.completed).toBe(false);
  });

  it('não cria rota com identificador diferente do usuário recebido', () => {
    const checklist = service.buildChecklist({ uid: 'couple-42' } as IUserDados);
    const photoItem = checklist.items.find((item) => item.id === 'photo');

    expect(photoItem?.routerLink.join('/')).toContain('couple-42');
  });
});
