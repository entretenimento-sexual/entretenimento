import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { AdminModerationReportService } from './admin-moderation-report.service';
import { ModerationReportService } from './moderation-report.service';

describe('lazy Functions injection nos serviços de moderação', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        {
          provide: AuthSessionService,
          useValue: {
            readyUid$: of('viewer-uid'),
          },
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: vi.fn(),
            deferObservable$: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    });
  });

  it('cria ModerationReportService sem provider de Functions', () => {
    expect(TestBed.inject(ModerationReportService)).toBeTruthy();
  });

  it('cria AdminModerationReportService sem provider de Functions', () => {
    expect(TestBed.inject(AdminModerationReportService)).toBeTruthy();
  });
});
