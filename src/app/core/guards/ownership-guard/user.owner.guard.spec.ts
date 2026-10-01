import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '../../services/error-handler/application-error.service';
import { UserOwnerGuard } from './user.owner.guard';

describe('UserOwnerGuard', () => {
  function setup(input?: {
    authUid$?: any;
    appUser$?: any;
    ready$?: any;
  }) {
    const createUrlTree = vi.fn((commands: any[], extras?: any) => ({
      commands,
      extras,
    }));
    const report = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserOwnerGuard,
        {
          provide: Router,
          useValue: { createUrlTree },
        },
        {
          provide: AccessControlService,
          useValue: {
            ready$: input?.ready$ ?? of(true),
            authUid$: input?.authUid$ ?? of('u1'),
            appUser$: input?.appUser$ ?? of({ uid: 'u1' }),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
      ],
    });

    return {
      guard: TestBed.inject(UserOwnerGuard),
      createUrlTree,
      report,
    };
  }

  function route(uid: string | null) {
    return {
      paramMap: {
        get: vi.fn((name: string) =>
          name === 'uid' ? uid : null
        ),
      },
    } as any;
  }

  const state = { url: '/perfil/u1/editar-dados-pessoais' } as any;

  it('libera somente o próprio uid', async () => {
    const { guard } = setup();

    await expect(
      firstValueFrom(guard.canActivate(route('u1'), state))
    ).resolves.toBe(true);
  });

  it('redireciona uid alheio para o dashboard', async () => {
    const { guard, createUrlTree } = setup();

    await firstValueFrom(guard.canActivate(route('u2'), state));

    expect(createUrlTree).toHaveBeenCalledWith(['/dashboard/principal']);
  });

  it('diagnostica falha de autoridade silenciosamente e falha fechado', async () => {
    const error = new Error('authority failed');
    const { guard, report, createUrlTree } = setup({
      authUid$: throwError(() => error),
    });

    await firstValueFrom(guard.canActivate(route('u1'), state));

    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-view',
      operation: 'UserOwnerGuard.canActivate',
      fallbackMessage:
        'Não foi possível validar o acesso a este perfil.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'UserOwnerGuard',
        hasRouteId: true,
      },
    });
    expect(createUrlTree).toHaveBeenCalledWith(['/dashboard/principal']);
  });
});
