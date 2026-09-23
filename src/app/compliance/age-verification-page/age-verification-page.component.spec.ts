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
  assuranceLevel: 'NONE',
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
    submitSelfAttestation$: MockFn;
  };

  beforeEach(async () => {
    current$ = new BehaviorSubject<IUserAgeEligibility>(UNVERIFIED);
    adultAccessAllowed$ = new BehaviorSubject<boolean>(false);

    ageEligibilityMock = {
      current$: current$.asObservable(),
      adultAccessAllowed$: adultAccessAllowed$.asObservable(),
      submitSelfAttestation$: vi.fn(() =>
        of({
          status: 'DECLARED_ADULT',
          assuranceLevel: 'SELF_ATTESTED',
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

  it('registra a autodeclaração em uma única ação e avança', async () => {
    component.confirmAdult();

    expect(ageEligibilityMock.submitSelfAttestation$).toHaveBeenCalledTimes(1);

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

  it('preserva prova forte já existente sem rebaixá-la', async () => {
    ageEligibilityMock.submitSelfAttestation$.mockReturnValueOnce(
      of({
        status: 'VERIFIED_ADULT',
        assuranceLevel: 'VERIFIED',
      })
    );

    component.confirmAdult();

    await vi.waitFor(() => {
      expect(component.feedback()).toEqual(
        expect.objectContaining({
          tone: 'success',
          title: 'Maioridade já verificada',
        })
      );
    });
  });

  it('mantém erro importante como feedback persistente na própria tela', () => {
    ageEligibilityMock.submitSelfAttestation$.mockReturnValueOnce(
      throwError(() => new Error('network unavailable'))
    );

    component.confirmAdult();

    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'error',
        title: 'Não foi possível confirmar agora',
      })
    );
    expect(component.processing()).toBe(false);
  });

  it('segue automaticamente quando o backend passa a permitir acesso adulto', async () => {
    adultAccessAllowed$.next(true);

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(
        ['/adulto/confirmar'],
        expect.objectContaining({
          replaceUrl: true,
        })
      );
    });
  });

  it('mantém conta e notificações acessíveis em estados restritos', async () => {
    component.goToNotifications();
    component.goToAccount();

    await vi.waitFor(() => {
      expect(router.navigate).toHaveBeenCalledWith(['/notificacoes']);
      expect(router.navigate).toHaveBeenCalledWith(['/conta']);
    });
  });
});
