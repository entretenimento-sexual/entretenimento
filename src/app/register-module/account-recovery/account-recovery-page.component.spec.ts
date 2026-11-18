import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { LogoutService } from '@core/services/autentication/auth/logout.service';
import { RegistrationRecoveryService } from '@core/services/autentication/register/registration-recovery.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { AccountRecoveryPageComponent } from './account-recovery-page.component';

describe('AccountRecoveryPageComponent', () => {
  it('retoma a navegação após falha sem repetir a recuperação já confirmada', async () => {
    const recoverForUser$ = vi.fn(() => of({ user: { uid: 'u1' } }));
    const navigateByUrl = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const route = { snapshot: { queryParamMap: convertToParamMap({ redirectTo: '/dashboard/principal' }) } };
    const router = { url: '/register/recuperar-conta', navigateByUrl };
    const session = { currentAuthUser: { uid: 'u1' }, isTerminatingSnapshot: false };
    const errors = { report: vi.fn() };
    const vm$ = new BehaviorSubject({
      uid: 'u1',
      userResolved: true,
      userExists: true,
      currentStep: 'ageVerification',
      nextRoute: '/adulto/verificar-idade',
    });

    await TestBed.configureTestingModule({
      imports: [AccountRecoveryPageComponent],
      providers: [
        { provide: AuthSessionService, useValue: session },
        { provide: RegistrationRecoveryService, useValue: { recoverForUser$ } },
        { provide: RegisterFlowFacade, useValue: { vm$ } },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: LogoutService, useValue: {} },
        { provide: ApplicationErrorService, useValue: errors },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AccountRecoveryPageComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isWorking()).toBe(true);
    await vi.waitFor(() => expect(component.status()).toBe('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('Os dados da conta foram confirmados');
    expect(navigateByUrl).toHaveBeenCalledWith(
      '/adulto/verificar-idade?redirectTo=%2Fdashboard%2Fprincipal', { replaceUrl: true }
    );

    router.url = '/adulto/verificar-idade';
    component.recover();

    await vi.waitFor(() => expect(component.status()).toBe('success'));
    expect(recoverForUser$).toHaveBeenCalledExactlyOnceWith('u1');
    expect(navigateByUrl).toHaveBeenCalledTimes(2);
  });
});
