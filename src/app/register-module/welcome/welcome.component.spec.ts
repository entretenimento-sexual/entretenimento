// src/app/register-module/welcome/welcome.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WelcomeComponent } from './welcome.component';
import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { EmulatorEmailVerifyDevService } from '../../core/services/autentication/register/emulator-email-verify-dev.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';

class EmailVerificationServiceMock {
  resendVerificationEmail() { return of('OK'); }
}

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WelcomeComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        {
          provide: RegisterFlowFacade,
          useValue: {
            vm$: of({
              uid: 'u1',
              email: 'user@example.com',
              emailVerified: false,
              profileCompleted: false,
              userResolved: true,
              authReady: true,
              currentStep: 'profileCompletion',
              blockingMessage: null,
            }),
            reloadAndSyncEmailVerification$: vi.fn(() => of(false)),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            authUser$: of({ uid: 'u1', email: 'user@example.com' }),
            ready$: of(true),
          },
        },
        { provide: EmailVerificationService, useClass: EmailVerificationServiceMock },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
            showInfo: vi.fn(),
          },
        },
        {
          provide: EmulatorEmailVerifyDevService,
          useValue: {
            markVerifiedInEmulatorDebug$: vi.fn(() => of({ after: { emailVerified: true } })),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
