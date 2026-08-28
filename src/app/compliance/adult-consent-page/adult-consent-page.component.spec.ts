import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AdultConsentPageComponent } from './adult-consent-page.component';

type MockFn = ReturnType<typeof vi.fn>;

describe('AdultConsentPageComponent', () => {
  let fixture: ComponentFixture<AdultConsentPageComponent>;
  let component: AdultConsentPageComponent;
  let router: Router;

  let adultConsentMock: {
    acceptCurrentConsent$: MockFn;
    clearCurrentConsentCache$: MockFn;
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
    adultConsentMock = {
      acceptCurrentConsent$: vi.fn(() => of('u1')),
      clearCurrentConsentCache$: vi.fn(() => of(void 0)),
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
      imports: [AdultConsentPageComponent, RouterTestingModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: emptyParams,
            },
          },
        },
        {
          provide: AdultConsentService,
          useValue: adultConsentMock,
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

    fixture = TestBed.createComponent(AdultConsentPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('mantém o feedback da falha de persistência sem duplicar diagnóstico na página', () => {
    adultConsentMock.acceptCurrentConsent$.mockReturnValueOnce(
      throwError(() => new Error('adult-consent-write-failed'))
    );

    component.accept();

    expect(errorNotifierMock.showError).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível confirmar sua maioridade agora. Verifique a conexão e tente novamente.'
    );
    expect(globalErrorHandlerMock.handleError).not.toHaveBeenCalled();
    expect(component.isSaving).toBe(false);
  });

  it('usa o fallback sem feedback de erro quando só a navegação principal falha', async () => {
    (router.navigateByUrl as unknown as MockFn).mockResolvedValueOnce(false);

    component.accept();

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(
        ['/preferencias/editar', 'u1'],
        { replaceUrl: true }
      );
    });

    expect(globalErrorHandlerMock.handleError).not.toHaveBeenCalled();
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
  });

  it('reporta uma vez quando a navegação principal e o fallback falham', async () => {
    (router.navigateByUrl as unknown as MockFn).mockResolvedValueOnce(false);
    (router.navigate as unknown as MockFn).mockResolvedValueOnce(false);

    component.accept();

    await vi.waitFor(() => {
      expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
    });

    const [reportedError] = globalErrorHandlerMock.handleError.mock.calls[0];
    expect(reportedError.context).toBe(
      'AdultConsentPageComponent.navigateAfterConsent'
    );
    expect(reportedError.skipUserNotification).toBe(true);
    expect(errorNotifierMock.showError).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Sua confirmação de maioridade foi registrada, mas não foi possível avançar. Recarregue a página e tente novamente.'
    );
  });

  it('mantém um único feedback quando a saída após recusa falha no serviço', () => {
    logoutMock.logout$.mockReturnValueOnce(
      throwError(() => new Error('logout-failed'))
    );

    component.decline();

    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'Acesso permitido apenas para maiores de 18 anos.',
      4200
    );
    expect(errorNotifierMock.showError).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível encerrar sua sessão. Tente novamente.'
    );
    expect(globalErrorHandlerMock.handleError).not.toHaveBeenCalled();
    expect(component.isSaving).toBe(false);
  });

  it('mantém a confirmação ocupada até a navegação terminar', async () => {
    let resolveNavigation!: (value: boolean) => void;
    const navigationPending = new Promise<boolean>((resolve) => {
      resolveNavigation = resolve;
    });

    (router.navigateByUrl as unknown as MockFn).mockReturnValueOnce(
      navigationPending
    );

    component.accept();

    expect(component.isSaving).toBe(true);

    resolveNavigation(true);

    await vi.waitFor(() => {
      expect(component.isSaving).toBe(false);
    });
  });
});
