// src/app/core/services/autentication/login.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginService } from './login.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';

describe('LoginService', () => {
  let service: LoginService;
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        LoginService,
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUser$: vi.fn(() => of(null)),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
        {
          provide: Auth,
          useValue: { currentUser: null },
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: (task: () => Promise<unknown>) => of(task()),
          },
        },
      ],
    });

    service = TestBed.inject(LoginService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('falha fechado ao reautenticar sem usuário com provedor de senha', async () => {
    await expect(
      firstValueFrom(service.reauthenticateUser$('senha-segura'))
    ).rejects.toThrow(
      'Não foi possível confirmar uma conta com senha nesta sessão.'
    );

    expect(handleError).toHaveBeenCalledTimes(1);
  });

  it('rejeita recuperação com e-mail inválido antes da rede', async () => {
    await expect(
      firstValueFrom(service.sendPasswordReset$('email-invalido'))
    ).rejects.toThrow('Informe um e-mail válido.');

    expect(handleError).toHaveBeenCalledTimes(1);
  });

  it('rejeita confirmação com senha abaixo do mínimo', async () => {
    await expect(
      firstValueFrom(service.confirmPasswordReset$('codigo', '1234567'))
    ).rejects.toThrow('pelo menos 8 caracteres');

    expect(handleError).toHaveBeenCalledTimes(1);
  });
});
