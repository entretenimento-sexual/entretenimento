import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { roleGuard } from './role.guard';

const USER: IUserDados = {
  uid: 'u1',
  email: 'u1@example.com',
  photoURL: null,
  role: 'premium',
  tier: 'premium',
  lastLogin: 1,
  descricao: '',
  isSubscriber: true,
};

describe('roleGuard', () => {
  let hasAnyMock: ReturnType<typeof vi.fn>;
  let createUrlTreeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hasAnyMock = vi.fn(() => of(true));
    createUrlTreeMock = vi.fn(
      (commands: unknown[], extras: unknown) => ({
        commands,
        extras,
      })
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: { createUrlTree: createUrlTreeMock },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            getLoggedUserUID$: () => of('u1'),
            user$: of(USER),
          },
        },
        {
          provide: AccessControlService,
          useValue: { hasAny$: hasAnyMock },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function runGuard(allowedRoles: unknown): Promise<unknown> {
    const route = {
      data: { allowedRoles },
    } as unknown as ActivatedRouteSnapshot;
    const state = {
      url: '/area-protegida',
    } as RouterStateSnapshot;

    const result = TestBed.runInInjectionContext(() =>
      roleGuard(route, state)
    );

    return firstValueFrom(result as Observable<unknown>);
  }

  it('delega roles pagos ao AccessControlService canônico', async () => {
    await expect(runGuard(['premium'])).resolves.toBe(true);

    expect(hasAnyMock).toHaveBeenCalledTimes(1);
    expect(hasAnyMock).toHaveBeenCalledWith(['premium']);
  });

  it('não concede acesso apenas porque user.role contém tier pago', async () => {
    hasAnyMock.mockReturnValueOnce(of(false));

    const result = await runGuard(['premium']);

    expect(result).not.toBe(true);
    expect(hasAnyMock).toHaveBeenCalledWith(['premium']);
    expect(createUrlTreeMock).toHaveBeenCalledWith(
      ['/dashboard/principal'],
      {
        queryParams: {
          reason: 'role_denied',
          redirectTo: '/area-protegida',
        },
      }
    );
  });

  it('falha fechado quando a rota declara somente roles desconhecidas', async () => {
    const result = await runGuard(['gold']);

    expect(result).not.toBe(true);
    expect(hasAnyMock).not.toHaveBeenCalled();
    expect(createUrlTreeMock).toHaveBeenCalledWith(
      ['/dashboard/principal'],
      {
        queryParams: {
          reason: 'role_configuration_invalid',
          redirectTo: '/area-protegida',
        },
      }
    );
  });

  it('preserva rota sem restrição quando allowedRoles está ausente', async () => {
    await expect(runGuard(undefined)).resolves.toBe(true);

    expect(hasAnyMock).not.toHaveBeenCalled();
  });
});
