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

describe('AgeVerificationPageComponent', () => {
  let fixture: ComponentFixture<AgeVerificationPageComponent>;
  let component: AgeVerificationPageComponent;
  let router: Router;
  let current$: BehaviorSubject<IUserAgeEligibility>;
  let verifiedAdult$: BehaviorSubject<boolean>;

  let ageEligibilityMock: {
    current$: unknown;
    verifiedAdult$: unknown;
    refreshTrustedSources$: MockFn;
    requestInitialReview$: MockFn;
  };

  beforeEach(async () => {
    current$ = new BehaviorSubject<IUserAgeEligibility>(UNVERIFIED);
    verifiedAdult$ = new BehaviorSubject<boolean>(false);

    ageEligibilityMock = {
      current$: current$.asObservable(),
      verifiedAdult$: verifiedAdult$.asObservable(),
      refreshTrustedSources$: vi.fn(() => of('UNVERIFIED')),
      requestInitialReview$: vi.fn(() =>
        of({
          reportId: 'age-review-1',
          status: 'REVIEW_REQUIRED',
        })
      ),
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

  it('faz uma tentativa silenciosa em fontes confiáveis antes de abrir revisão', () => {
    component.verifyNow();

    expect(ageEligibilityMock.refreshTrustedSources$).toHaveBeenCalledTimes(1);
    expect(ageEligibilityMock.requestInitialReview$).toHaveBeenCalledTimes(1);
    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'success',
        title: 'Solicitação recebida',
      })
    );
    expect(component.processing()).toBe(false);
  });

  it('não cria solicitação duplicada quando a conta já está em revisão', () => {
    ageEligibilityMock.refreshTrustedSources$.mockReturnValueOnce(
      of('REVIEW_REQUIRED')
    );

    component.verifyNow();

    expect(ageEligibilityMock.requestInitialReview$).not.toHaveBeenCalled();
    expect(component.feedback()).toEqual(
      expect.objectContaining({
        title: 'Solicitação recebida',
      })
    );
  });

  it('avança automaticamente quando uma fonte confiável já confirma a maioridade', async () => {
    ageEligibilityMock.refreshTrustedSources$.mockReturnValueOnce(
      of('VERIFIED_ADULT')
    );

    component.verifyNow();

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

  it('mantém erro importante como feedback persistente da própria tela', () => {
    ageEligibilityMock.refreshTrustedSources$.mockReturnValueOnce(
      throwError(() => new Error('network unavailable'))
    );

    component.verifyNow();

    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'error',
        title: 'Não foi possível continuar',
      })
    );
    expect(ageEligibilityMock.requestInitialReview$).not.toHaveBeenCalled();
  });

  it('libera conta e notificações durante a espera sem abrir recurso social adulto', async () => {
    component.goToNotifications();
    component.goToAccount();

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(['/notificacoes']);
      expect(router.navigate).toHaveBeenCalledWith(['/conta']);
    });
  });

  it('segue automaticamente quando a projeção realtime muda para adulta', async () => {
    verifiedAdult$.next(true);

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(
        ['/adulto/confirmar'],
        expect.objectContaining({
          replaceUrl: true,
        })
      );
    });
  });
});
