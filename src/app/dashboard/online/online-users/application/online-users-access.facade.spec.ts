import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { OnlineUsersAccessFacade } from './online-users-access.facade';

describe('OnlineUsersAccessFacade', () => {
  function setup(input?: {
    uid?: string | null;
    user?: any | null;
    status?: any;
    canRun?: boolean;
    profileEligible?: boolean;
    url?: string;
  }) {
    const user =
      input?.user === undefined
        ? {
            uid: 'u1',
            emailVerified: true,
            profileCompleted: true,
          }
        : input.user;
    const status = input?.status ?? 'ready';

    const select = vi.fn((selector: any) => {
      if (selector === selectCurrentUser) return of(user);
      if (selector === selectCurrentUserStatus) return of(status);
      return of(null);
    });

    const navigate = vi.fn(() => Promise.resolve(true));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OnlineUsersAccessFacade,
        {
          provide: Store,
          useValue: { select },
        },
        {
          provide: AccessControlService,
          useValue: {
            authUid$: of(
              input?.uid === undefined ? 'u1' : input.uid
            ),
            canRunOnlineUsers$: of(input?.canRun ?? true),
            profileEligible$: of(
              input?.profileEligible ?? true
            ),
          },
        },
        {
          provide: Router,
          useValue: {
            url: input?.url ?? '/dashboard/explorar?modo=nearby',
            navigate,
          },
        },
      ],
    });

    return {
      facade: TestBed.inject(OnlineUsersAccessFacade),
      navigate,
    };
  }

  it('libera o gate apenas com sessão e usuário operacional', async () => {
    const { facade } = setup();

    await expect(firstValueFrom(facade.gate$)).resolves.toEqual({
      canStart: true,
      uid: 'u1',
      user: expect.objectContaining({ uid: 'u1' }),
    });
  });

  it('classifica perfil incompleto antes de ativar localização', async () => {
    const { facade } = setup({
      profileEligible: false,
    });

    await expect(
      firstValueFrom(facade.checkLocationAccess$())
    ).resolves.toEqual({
      kind: 'profile_incomplete',
    });
  });

  it('classifica sessão ausente sem liberar geolocalização', async () => {
    const { facade } = setup({
      uid: null,
      user: null,
      status: 'signed_out',
    });

    await expect(
      firstValueFrom(facade.checkLocationAccess$())
    ).resolves.toEqual({
      kind: 'signed_out',
    });
  });

  it('leva conta não verificada para welcome preservando redirect seguro', async () => {
    const { facade, navigate } = setup({
      user: {
        uid: 'u1',
        emailVerified: false,
        profileCompleted: false,
      },
      url: '/dashboard/explorar?modo=nearby',
    });

    await facade.goToFinishMinimumProfile();

    expect(navigate).toHaveBeenCalledWith(
      ['/register/welcome'],
      {
        queryParams: {
          autocheck: '1',
          reason: 'email_unverified',
          redirectTo: '/dashboard/explorar?modo=nearby',
        },
      }
    );
  });

  it('leva perfil incompleto verificado para finalizar cadastro', async () => {
    const { facade, navigate } = setup({
      user: {
        uid: 'u1',
        emailVerified: true,
        profileCompleted: false,
      },
    });

    await facade.goToFinishMinimumProfile();

    expect(navigate).toHaveBeenCalledWith(
      ['/register/finalizar-cadastro'],
      {
        queryParams: {
          reason: 'profile_incomplete',
          redirectTo: '/dashboard/explorar?modo=nearby',
        },
      }
    );
  });

  it('normaliza redirect externo inseguro para exploração', async () => {
    const { facade, navigate } = setup({
      user: {
        uid: 'u1',
        emailVerified: true,
        profileCompleted: false,
      },
      url: '//evil.example',
    });

    await facade.goToFinishMinimumProfile();

    expect(navigate).toHaveBeenCalledWith(
      ['/register/finalizar-cadastro'],
      {
        queryParams: {
          reason: 'profile_incomplete',
          redirectTo: '/dashboard/explorar',
        },
      }
    );
  });
});
