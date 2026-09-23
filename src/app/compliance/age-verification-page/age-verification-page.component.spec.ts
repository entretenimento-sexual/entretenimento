import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
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
  let adultAccessAllowed$: BehaviorSubject<boolean>;

  let ageEligibilityMock: {
    current$: unknown;
    adultAccessAllowed$: unknown;
    declareAdultAccess$: MockFn;
  };

  beforeEach(async () => {
    current$ = new BehaviorSubject<IUserAgeEligibility>(UNVERIFIED);
    adultAccessAllowed$ = new BehaviorSubject<boolean>(false);

    ageEligibilityMock = {
      current$: current$.asObservable(),
      adultAccessAllowed$: adultAccessAllowed$.asObservable(),
      declareAdultAccess$: vi.fn(() =>
        of({
          status: 'DECLARED_ADULT',
          assurance: 'SELF_DECLARATION',
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

  it('registra explicitamente autodeclaração adulta sem abrir revisão inicial', () => {
    component.declareAdult();

    expect(ageEligibilityMock.declareAdultAccess$).toHaveBeenCalledTimes(1);
    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'success',
        title: 'Confirmação registrada',
      })
    );
    expect(component.processing()).toBe(false);
  });

  it('mantém falha como feedback persistente da própria tela', () => {
    ageEligibilityMock.declareAdultAccess$.mockReturnValueOnce(
      throwError(() => new Error('declaration unavailable'))
    );

    component.declareAdult();

    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'error',
        title: 'Não foi possível registrar sua confirmação',
      })
    );
  });

  it('permite substituir o REVIEW_REQUIRED legado criado pelo fluxo inicial antigo', async () => {
    current$.next({
      status: 'REVIEW_REQUIRED',
      policyVersion: 1,
      source: 'INITIAL_VERIFICATION',
      method: 'MANUAL_REVIEW',
      caseId: 'age_initial_abc123',
      verifiedAtMs: null,
      expiresAtMs: null,
      updatedAtMs: 2,
    });

    const vm = await firstValueFrom(component.vm$);

    expect(vm.legacyInitialReview).toBe(true);
    expect(vm.strongReviewRequired).toBe(false);
    expect(vm.canSelfDeclare).toBe(true);
  });

  it('não apresenta autodeclaração como substituta de uma análise forte', async () => {
    current$.next({
      status: 'REVIEW_REQUIRED',
      policyVersion: 1,
      source: 'INITIAL_VERIFICATION',
      method: 'EXTERNAL_PROVIDER',
      caseId: 'provider_conflict_1',
      verifiedAtMs: null,
      expiresAtMs: null,
      updatedAtMs: 2,
    });

    const vm = await firstValueFrom(component.vm$);

    expect(vm.legacyInitialReview).toBe(false);
    expect(vm.strongReviewRequired).toBe(true);
    expect(vm.canSelfDeclare).toBe(false);
  });

  it('segue automaticamente quando a projeção backend libera acesso adulto', async () => {
    adultAccessAllowed$.next(true);

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

  it('libera conta e notificações em estados restritos', async () => {
    component.goToNotifications();
    component.goToAccount();

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(['/notificacoes']);
      expect(router.navigate).toHaveBeenCalledWith(['/conta']);
    });
  });
});
