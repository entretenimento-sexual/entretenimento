import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { NetworkStatusService } from '@core/services/network/network-status.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { OwnProfileContextFacade } from './own-profile-context.facade';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
  selectCurrentUserUid,
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { Store } from '@ngrx/store';

describe('OwnProfileContextFacade', () => {
  function setup(input?: {
    routeUid?: string | null;
    authUid?: string | null;
    user?: any | null;
    status?: any;
    offline?: boolean;
  }) {
    const routeUid = input?.routeUid;
    const authUid = input?.authUid === undefined ? 'me' : input.authUid;
    const user = input?.user === undefined
      ? { uid: 'me', nickname: 'Pessoa' }
      : input.user;
    const status = input?.status ?? (authUid ? 'ready' : 'signed_out');

    const selectorValues = new Map<any, any>([
      [selectCurrentUserUid, authUid],
      [selectCurrentUser, user],
      [selectCurrentUserStatus, status],
    ]);

    const dispatch = vi.fn();
    const select = vi.fn((selector: any) => of(selectorValues.get(selector)));
    const navigate = vi.fn(() => Promise.resolve(true));
    const showWarning = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        OwnProfileContextFacade,
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(
              convertToParamMap(
                routeUid === null || routeUid === undefined
                  ? {}
                  : { uid: routeUid }
              )
            ),
          },
        },
        {
          provide: Router,
          useValue: { navigate },
        },
        {
          provide: Store,
          useValue: { select, dispatch },
        },
        {
          provide: NetworkStatusService,
          useValue: {
            isOffline$: of(input?.offline === true),
            isOnlineSnapshot: () => input?.offline !== true,
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showWarning },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    return {
      facade: TestBed.inject(OwnProfileContextFacade),
      dispatch,
      navigate,
      showWarning,
    };
  }

  it('mantém /perfil no usuário autenticado', async () => {
    const { facade } = setup();

    await expect(firstValueFrom(facade.context$)).resolves.toEqual({
      uid: 'me',
      authUid: 'me',
      routeUid: null,
      redirectingToOtherProfile: false,
    });

    await expect(firstValueFrom(facade.user$)).resolves.toEqual({
      uid: 'me',
      nickname: 'Pessoa',
    });
  });

  it('redireciona uid externo para o perfil público sem expor usuário privado', async () => {
    const { facade, navigate } = setup({ routeUid: 'other' });

    facade.init();

    await Promise.resolve();

    expect(navigate).toHaveBeenCalledWith(
      ['/outro-perfil', 'other'],
      { replaceUrl: true }
    );
    await expect(firstValueFrom(facade.user$)).resolves.toBeNull();
  });

  it('projeta perfil salvo como stale quando offline', async () => {
    const { facade } = setup({ offline: true });

    await expect(firstValueFrom(facade.contentState$)).resolves.toEqual({
      state: 'stale',
      title: 'Exibindo seu perfil salvo',
      message:
        'A conexão está indisponível. Alterações recentes podem aparecer quando você voltar a ficar online.',
      actionLabel: '',
      compact: true,
    });
  });

  it('projeta offline quando o perfil ainda não está no cache', async () => {
    const { facade } = setup({
      user: null,
      status: 'unavailable',
      offline: true,
    });

    await expect(firstValueFrom(facade.contentState$)).resolves.toEqual({
      state: 'offline',
      title: 'Perfil indisponível sem conexão',
      message:
        'Este perfil ainda não está no cache deste dispositivo. Conecte-se para carregá-lo.',
      actionLabel: 'Tentar novamente',
      compact: false,
    });
  });

  it('retry despacha a observação canônica quando online', () => {
    const { facade, dispatch } = setup();

    facade.retryProfile('me');

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'me',
      })
    );
  });

  it('retry offline preserva o store e mostra warning', () => {
    const { facade, dispatch, showWarning } = setup({ offline: true });

    facade.retryProfile('me');

    expect(dispatch).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      'Aguarde a conexão voltar para atualizar seu perfil.'
    );
  });
});
