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

  it('não cria rota com identificador diferente do usuário recebido', () => {
    const checklist = service.buildChecklist({ uid: 'couple-42' } as IUserDados);
    const photoItem = checklist.items.find((item) => item.id === 'photo');

    expect(photoItem?.routerLink.join('/')).toContain('couple-42');
  });
});
