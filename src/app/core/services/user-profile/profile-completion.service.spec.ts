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

  it('considera a idade social preenchida como etapa de perfil concluída', () => {
    const checklist = service.buildChecklist({
      uid: 'user-1',
      idade: 35,
      ageEligibility: null,
    } as IUserDados);
    const ageItem = checklist.items.find((item) => item.id === 'age');

    expect(ageItem?.completed).toBe(true);
    expect(ageItem?.title).toBe('Idade no perfil');
    expect(ageItem?.actionLabel).toBe('Informar idade no perfil');
    expect(ageItem?.routerLink).toEqual([
      '/perfil',
      'user-1',
      'editar-dados-pessoais',
    ]);
  });

  it('não usa confirmação de maioridade como substituta da idade social do perfil', () => {
    const checklist = service.buildChecklist({
      uid: 'user-1',
      idade: undefined,
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: Date.now() - 10_000,
        expiresAtMs: Date.now() + 10_000,
        updatedAtMs: Date.now(),
      },
    } as IUserDados);
    const ageItem = checklist.items.find((item) => item.id === 'age');

    expect(ageItem?.completed).toBe(false);
  });

  it('rejeita idade social fora da faixa adulta de perfil', () => {
    expect(
      service.buildChecklist({ uid: 'user-1', idade: 17 } as IUserDados)
        .items.find((item) => item.id === 'age')?.completed
    ).toBe(false);
    expect(
      service.buildChecklist({ uid: 'user-1', idade: 101 } as IUserDados)
        .items.find((item) => item.id === 'age')?.completed
    ).toBe(false);
  });

  it('não cria rota com identificador diferente do usuário recebido', () => {
    const checklist = service.buildChecklist({ uid: 'couple-42' } as IUserDados);
    const photoItem = checklist.items.find((item) => item.id === 'photo');

    expect(photoItem?.routerLink.join('/')).toContain('couple-42');
  });
});
