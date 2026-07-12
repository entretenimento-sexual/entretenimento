// src/app/core/services/autentication/register/register.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { RegisterService } from './register.service';
import { EmailVerificationService } from './email-verification.service';
import { RegistrationBootstrapService } from './registration-bootstrap.service';
import { TermsAcceptanceService } from '../../compliance/terms-acceptance.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore/validation/firestore-validation.service';
import { CacheService } from '../../general/cache/cache.service';

describe('RegisterService', () => {
  let service: RegisterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RegisterService,
        {
          provide: EmailVerificationService,
          useValue: {
            sendEmailVerification: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: RegistrationBootstrapService,
          useValue: {
            createEmailPasswordSeed$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: TermsAcceptanceService,
          useValue: {
            acceptForUser$: vi.fn(() =>
              of({
                uid: 'uid-test',
                record: {
                  accepted: true,
                  version: 'v1',
                  date: Date.now(),
                },
              })
            ),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: FirestoreValidationService,
          useValue: {
            validateUserData: vi.fn(() => true),
            checkIfNicknameExists: vi.fn(() => of(false)),
          },
        },
        {
          provide: CacheService,
          useValue: {
            set: vi.fn(),
            get: vi.fn(() => of(null)),
          },
        },
        {
          provide: Auth,
          useValue: {
            currentUser: null,
          },
        },
      ],
    });
    service = TestBed.inject(RegisterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
