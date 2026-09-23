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
  let adultAccessAllowed$: BehaviorSubject<boolean>;
  let ageEligibilityMock: {
    current$: unknown;
    adultAccessAllowed$: unknown;
    acceptSelfDeclaration$: MockFn;
  };

  beforeEach(async () => {
    current$ = new BehaviorSubject<IUserAgeEligibility>(UNVERIFIED);
    adultAccessAllowed$ = new BehaviorSubject<boolean>(false);

    ageEligibilityMock = {
      current$: current$.asObservable(),
      adultAccessAllowed$: adultAccessAllowed$.asObservable(),
      acceptSelfDeclaration$: vi.fn(() => of('SELF_DECLARED_ADULT')),
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

  it('registra uma autodeclaração explícita e avança sem revisão humana', async () => {
    component.confirmAdult();

    expect(ageEligibilityMock.acceptSelfDeclaration$).toHaveBeenCalledTimes(1);
    expect(component.feedback()).toEqual(
      expect.objectContaining({
        tone: 'success',
        title: 'Maioridade declarada',
      })
    );

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

  it('segue automaticamente quando a projeção backend libera acesso adulto', async () => {
    adultAccessAllowed$.next(true);

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
});
