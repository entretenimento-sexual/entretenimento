// src/app/core/services/autentication/login.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { LoginService } from './login.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';

describe('LoginService', () => {
  let service: LoginService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        LoginService,
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUserOnce$: vi.fn(() => of(null)),
            getPublicUserById$: vi.fn(() => of(null)),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: Auth,
          useValue: {},
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: (task: () => Promise<unknown>) => of(task()),
          },
        },
      ],
    });
    service = TestBed.inject(LoginService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
