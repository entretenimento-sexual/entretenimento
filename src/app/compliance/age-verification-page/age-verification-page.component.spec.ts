import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
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

const VERIFIED: IUserAgeEligibility = {
  ...UNVERIFIED,
  status: 'VERIFIED_ADULT',
  source: 'INITIAL_VERIFICATION',
  method: 'EXTERNAL_PROVIDER',
  verifiedAtMs: 1,
  updatedAtMs: 2,
};

describe('AgeVerificationPageComponent', () => {
  let fixture: ComponentFixture<AgeVerificationPageComponent>;
  let component: AgeVerificationPageComponent;
  let router: Router;
  let current$: BehaviorSubject<IUserAgeEligibility>;
  let ageEligibilityMock: {
    current$: unknown;
    reconcileTrustedStateOncePerSession$: MockFn;
    requestInitialReview$: MockFn;
    refreshTrustedSources$: MockFn;
    acceptSelfDeclaration$: MockFn;
    getCurrentOnce$: MockFn;
  };

  beforeEach(async () => {
    current$ = new BehaviorSubject<IUserAgeEligibility>(UNVERIFIED);

    ageEligibilityMock = {
      current$: current$.asObservable(),
      reconcileTrustedStateOncePerSession$: vi.fn(
        () => of(current$.value)
      ),
      requestInitialReview$: vi.fn(() =>
        of({ reportId: 'age_initial_1', status: 'REVIEW_REQUIRED' })
      ),
      refreshTrustedSources$: vi.fn(() => of('VERIFIED_ADULT')),
      acceptSelfDeclaration$: vi.fn(() => of('SELF_DECLARED_ADULT')),
      getCurrentOnce$: vi.fn(() => of(current$.value)),
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

  it('reconcilia silenciosamente antes de oferecer ação', () => {
    expect(
      ageEligibilityMock.reconcileTrustedStateOncePerSession$
    ).toHaveBeenCalledTimes(1);
    expect(ageEligibilityMock.requestInitialReview$).not.toHaveBeenCalled();
  });

  it('reconhece a declaração já existente sem solicitá-la novamente', async () => {
    current$.next({
      ...UNVERIFIED,
      status: 'SELF_DECLARED_ADULT',
      source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION',
      updatedAtMs: 2,
    });
    fixture.detectChanges();

    expect(ageEligibilityMock.acceptSelfDeclaration$).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(router.navigate).toHaveBeenCalledWith(
      ['/adulto/confirmar'],
      expect.objectContaining({ replaceUrl: true })
    ));
  });

  it('mantém feedback quando a confirmação de maioridade falha', () => {
    ageEligibilityMock.acceptSelfDeclaration$.mockReturnValueOnce(
      throwError(() => new Error('network unavailable'))
    );
    component.confirmAdult();
    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'error',
        title: 'Não foi possível registrar a confirmação 18+',
      })
    );
    expect(component.processing()).toBe(false);
  });

  it('mantém review existente sem botão de nova confirmação', () => {
    current$.next({
      ...UNVERIFIED,
      status: 'REVIEW_REQUIRED',
      source: 'INITIAL_VERIFICATION',
      method: 'MANUAL_REVIEW',
      caseId: 'age_initial_old',
    });
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent ?? '');

    expect(text).toContain('Verificação em análise');
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

  it('segue automaticamente somente com VERIFIED_ADULT confiável', async () => {
    current$.next(VERIFIED);

    await vi.waitFor(() => {
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

  it('permite a autodeclaração uma única vez no onboarding', async () => {
    ageEligibilityMock.acceptSelfDeclaration$.mockImplementationOnce(() => {
      current$.next({
        ...UNVERIFIED,
        status: 'SELF_DECLARED_ADULT',
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        updatedAtMs: 2,
      });
      return of('SELF_DECLARED_ADULT');
    });
    component.confirmAdult();
    expect(ageEligibilityMock.acceptSelfDeclaration$).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(router.navigate).toHaveBeenCalledWith(
      ['/adulto/confirmar'],
      expect.objectContaining({ replaceUrl: true })
    ));
  });
});
