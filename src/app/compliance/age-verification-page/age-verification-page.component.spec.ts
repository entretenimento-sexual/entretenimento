import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserAgeEligibility } from 'src/app/core/interfaces/iuser-dados';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { AgeEligibilityService } from 'src/app/core/services/compliance/age-eligibility.service';
import { AgeVerificationPageComponent } from './age-verification-page.component';

type MockFn = ReturnType<typeof vi.fn>;

const UNVERIFIED: IUserAgeEligibility = {
  status: 'UNVERIFIED',
  policyVersion: 1,
  source: 'INITIAL_VERIFICATION',
  method: 'MANUAL_REVIEW',
  caseId: null,
  verifiedAtMs: null,
  expiresAtMs: null,
  updatedAtMs: 1,
};

describe('AgeVerificationPageComponent', () => {
  let fixture: ComponentFixture<AgeVerificationPageComponent>;
  let component: AgeVerificationPageComponent;
  let router: Router;
  let current$: BehaviorSubject<IUserAgeEligibility>;
  let ageEligibilityMock: {
    current$: unknown;
    acceptSelfDeclaration$: MockFn;
    getCurrentOnce$: MockFn;
    refreshTrustedSources$: MockFn;
  };

  beforeEach(async () => {
    current$ = new BehaviorSubject<IUserAgeEligibility>(UNVERIFIED);

    ageEligibilityMock = {
      current$: current$.asObservable(),
      acceptSelfDeclaration$: vi.fn(() => of('SELF_DECLARED_ADULT')),
      getCurrentOnce$: vi.fn(() => current$.pipe(take(1))),
      refreshTrustedSources$: vi.fn(() => of('UNVERIFIED')),
    };

    await TestBed.configureTestingModule({
      imports: [AgeVerificationPageComponent, RouterTestingModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({
                redirectTo: '/dashboard/explorar',
              }),
            },
          },
        },
        {
          provide: AgeEligibilityService,
          useValue: ageEligibilityMock,
        },
        {
          provide: LogoutService,
          useValue: {
            logout$: vi.fn(() => of(void 0)),
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(AgeVerificationPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('não exibe a confirmação enquanto reconcilia o estado já salvo', () => {
    component.reconciling.set(true);
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent ?? '');

    expect(text).toContain('Verificando sua confirmação já registrada');
    expect(text).not.toContain('Confirmo que tenho 18 anos ou mais');
  });

  it('reconcilia confirmação canônica ausente da projeção antes de pedir novamente', async () => {
    ageEligibilityMock.refreshTrustedSources$.mockClear();
    ageEligibilityMock.refreshTrustedSources$.mockReturnValueOnce(
      of('SELF_DECLARED_ADULT')
    );

    fixture.destroy();

    fixture = TestBed.createComponent(AgeVerificationPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(ageEligibilityMock.getCurrentOnce$).toHaveBeenCalled();
    expect(ageEligibilityMock.refreshTrustedSources$).toHaveBeenCalledTimes(1);
    expect(ageEligibilityMock.acceptSelfDeclaration$).not.toHaveBeenCalled();
  });

  it('não pede nova autodeclaração quando o estado já está salvo', async () => {
    fixture.destroy();

    current$.next({
      ...UNVERIFIED,
      status: 'SELF_DECLARED_ADULT',
      source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION',
      updatedAtMs: Date.now(),
    });

    fixture = TestBed.createComponent(AgeVerificationPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(ageEligibilityMock.acceptSelfDeclaration$).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(
        ['/adulto/confirmar'],
        expect.objectContaining({
          replaceUrl: true,
        })
      );
    });
  });

  it('registra a autodeclaração e deixa a projeção backend autorizar o avanço', async () => {
    component.confirmAdult();

    expect(ageEligibilityMock.acceptSelfDeclaration$).toHaveBeenCalledTimes(1);
    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'success',
        title: 'Maioridade declarada',
      })
    );
    expect(router.navigate).not.toHaveBeenCalled();

    current$.next({
      ...UNVERIFIED,
      status: 'SELF_DECLARED_ADULT',
      source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION',
      updatedAtMs: Date.now(),
    });

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith(
        ['/adulto/confirmar'],
        {
          replaceUrl: true,
          queryParams: {
            redirectTo: '/dashboard/explorar',
          },
        }
      );
    });
  });

  it('mantém erro operacional como feedback persistente', () => {
    ageEligibilityMock.acceptSelfDeclaration$.mockReturnValueOnce(
      throwError(() => new Error('network unavailable'))
    );

    component.confirmAdult();

    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'error',
        title: 'Não foi possível continuar',
      })
    );
    expect(component.processing()).toBe(false);
  });

  it('permite migrar review criado apenas pelo onboarding antigo', () => {
    current$.next({
      ...UNVERIFIED,
      status: 'REVIEW_REQUIRED',
      source: 'INITIAL_VERIFICATION',
      method: 'MANUAL_REVIEW',
      caseId: 'age_initial_old',
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('O fluxo anterior foi substituído');
    expect(text).toContain('Confirmo que tenho 18 anos ou mais');
  });

  it('não tenta sobrescrever estados fortes na interface', async () => {
    current$.next({
      ...UNVERIFIED,
      status: 'REVIEW_REQUIRED',
      source: 'AGE_REVERIFICATION',
      method: 'MANUAL_REVIEW',
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Confirmação adicional necessária');
    expect(text).not.toContain('Confirmo que tenho 18 anos ou mais');
  });

  it('mantém conta e notificações acessíveis em estado restrito', async () => {
    component.goToNotifications();
    component.goToAccount();

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(['/notificacoes']);
      expect(router.navigate).toHaveBeenCalledWith(['/conta']);
    });
  });

  it('segue automaticamente quando a projeção backend libera a etapa etária', async () => {
    current$.next({
      ...UNVERIFIED,
      status: 'SELF_DECLARED_ADULT',
      source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION',
      updatedAtMs: Date.now(),
    });

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(
        ['/adulto/confirmar'],
        expect.objectContaining({
          replaceUrl: true,
          queryParams: {
            redirectTo: '/dashboard/explorar',
          },
        })
      );
    });
  });

  it('não cria uma segunda navegação quando a callable conclui antes da projeção realtime', async () => {
    component.confirmAdult();

    expect(router.navigate).not.toHaveBeenCalled();

    current$.next({
      ...UNVERIFIED,
      status: 'SELF_DECLARED_ADULT',
      source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION',
      updatedAtMs: Date.now(),
    });

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledTimes(1);
    });
  });
});
