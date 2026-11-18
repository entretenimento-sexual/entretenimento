import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { TermsAcceptanceService } from 'src/app/core/services/compliance/terms-acceptance.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { TermsAcceptancePageComponent } from './terms-acceptance-page.component';

type MockFn = ReturnType<typeof vi.fn>;

describe('TermsAcceptancePageComponent', () => {
  let fixture: ComponentFixture<TermsAcceptancePageComponent>;
  let component: TermsAcceptancePageComponent;
  let router: Router;

  let termsAcceptanceMock: {
    acceptCurrentTerms$: MockFn;
    acceptForUser$: MockFn;
    clearPendingSignupAcceptance: MockFn;
    hasPendingSignupAcceptance: MockFn;
  };
  let logoutMock: { logout$: MockFn };
  let globalErrorHandlerMock: { handleError: MockFn };
  let errorNotifierMock: {
    showError: MockFn;
    showSuccess: MockFn;
    showWarning: MockFn;
    showInfo: MockFn;
  };

  beforeEach(async () => {
    termsAcceptanceMock = {
      acceptCurrentTerms$: vi.fn(() => of({ uid: 'u1' })),
      acceptForUser$: vi.fn(() => of({ uid: 'u1' })),
      clearPendingSignupAcceptance: vi.fn(),
      hasPendingSignupAcceptance: vi.fn(() => false),
    };

    logoutMock = {
      logout$: vi.fn(() => of(void 0)),
    };

    globalErrorHandlerMock = {
      handleError: vi.fn(),
    };

    errorNotifierMock = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
    };

    const emptyParams = convertToParamMap({});

    await TestBed.configureTestingModule({
      imports: [
        TermsAcceptancePageComponent,
        RouterTestingModule,
      ],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(emptyParams),
            snapshot: {
              queryParamMap: emptyParams,
            },
          },
        },
        {
          provide: TermsAcceptanceService,
          useValue: termsAcceptanceMock,
        },
        {
          provide: RegisterFlowFacade,
          useValue: {
            vm$: of({
              uid: 'u1',
              termsAccepted: true,
              currentStep: 'profileCompletion',
              nextRoute: '/register/finalizar-cadastro',
            }),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of(null),
            getLoggedUserUIDSnapshot: () => 'u1',
          },
        },
        {
          provide: LogoutService,
          useValue: logoutMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorHandlerMock,
        },
        {
          provide: ErrorNotificationService,
          useValue: errorNotifierMock,
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(TermsAcceptancePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('bloqueia o avanço enquanto o aceite obrigatório não foi confirmado', () => {
    component.accept();

    expect(component.termsConfirmation.touched).toBe(true);
    expect(termsAcceptanceMock.acceptCurrentTerms$).not.toHaveBeenCalled();
    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'Confirme o aceite dos Termos de Uso e a ciência da Política de Privacidade.'
    );
  });

  it('retoma o aceite explícito pendente da conta atual sem exigir outro clique', () => {
    termsAcceptanceMock.hasPendingSignupAcceptance.mockReturnValue(true);
    fixture.destroy();
    fixture = TestBed.createComponent(TermsAcceptancePageComponent);
    component = fixture.componentInstance;

    expect(termsAcceptanceMock.acceptForUser$).toHaveBeenCalledWith('u1', { signupAdultDeclaration: true });
    expect(termsAcceptanceMock.acceptCurrentTerms$).not.toHaveBeenCalled();
    expect(component.acceptanceConfirmed()).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalled();
  });

  it('mantém um único feedback de UI quando o serviço de aceite propaga uma falha', () => {
    termsAcceptanceMock.acceptCurrentTerms$.mockReturnValueOnce(
      throwError(() => new Error('terms-write-failed'))
    );
    component.termsConfirmation.setValue(true);

    component.accept();

    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(component.operationMessage()).toBe(
      'Não foi possível registrar seu aceite agora. Verifique a conexão e tente novamente.'
    );
    expect(globalErrorHandlerMock.handleError).not.toHaveBeenCalled();
    expect(component.isSaving()).toBe(false);
  });

  it('libera a tela e delega o feedback de logout ao shell global', () => {
    logoutMock.logout$.mockReturnValueOnce(
      throwError(() => new Error('logout-failed'))
    );

    component.decline();

    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(globalErrorHandlerMock.handleError).not.toHaveBeenCalled();
    expect(component.isSaving()).toBe(false);
  });

  it('permite retomar a etapa canônica sem gravar o aceite outra vez', async () => {
    (router.navigateByUrl as unknown as MockFn).mockResolvedValueOnce(false);
    component.termsConfirmation.setValue(true);

    component.accept();

    await vi.waitFor(() => {
      expect(component.operationMessage()).toContain('Seu aceite foi registrado');
    });

    component.accept();
    await vi.waitFor(() => expect(component.isSaving()).toBe(false));

    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    expect(termsAcceptanceMock.acceptCurrentTerms$).toHaveBeenCalledExactlyOnceWith('u1');
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
  });

  it('reporta uma vez quando a navegação falha após o aceite', async () => {
    (router.navigateByUrl as unknown as MockFn).mockResolvedValueOnce(false);
    component.termsConfirmation.setValue(true);

    component.accept();

    await vi.waitFor(() => {
      expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
    });

    const [reportedError] = globalErrorHandlerMock.handleError.mock.calls[0];
    expect(reportedError.context).toBe(
      'TermsAcceptancePageComponent.navigateAfterAcceptance'
    );
    expect(reportedError.skipUserNotification).toBe(true);
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(component.operationMessage()).toBe(
      'Seu aceite foi registrado. Use Continuar cadastro para tentar abrir a próxima etapa.'
    );
  });

  it('mantém o formulário ocupado até a navegação terminar', async () => {
    let resolveNavigation!: (value: boolean) => void;
    const navigationPending = new Promise<boolean>((resolve) => {
      resolveNavigation = resolve;
    });

    (router.navigateByUrl as unknown as MockFn).mockReturnValueOnce(
      navigationPending
    );
    component.termsConfirmation.setValue(true);

    component.accept();

    expect(component.isSaving()).toBe(true);

    resolveNavigation(true);

    await vi.waitFor(() => {
      expect(component.isSaving()).toBe(false);
    });
  });
});
