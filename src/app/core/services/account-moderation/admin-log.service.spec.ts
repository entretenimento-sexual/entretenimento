import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { AdminLogService } from './admin-log.service';

describe('AdminLogService', () => {
  const writeMock = {
    addDocument: vi.fn(),
  };
  const readMock = {
    getDocumentsLive: vi.fn(),
  };
  const applicationErrorMock = {
    report: vi.fn(),
  };
  const authMock = {
    currentUser: { uid: 'admin-1' },
  };

  let service: AdminLogService;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        AdminLogService,
        { provide: Auth, useValue: authMock },
        { provide: FirestoreWriteService, useValue: writeMock },
        { provide: FirestoreReadService, useValue: readMock },
        { provide: ApplicationErrorService, useValue: applicationErrorMock },
      ],
    });

    service = TestBed.inject(AdminLogService);
  });

  it('mantém falha de auditoria silenciosa por padrão', async () => {
    const error = new Error('write failed');
    writeMock.addDocument.mockReturnValue(throwError(() => error));

    await expect(
      firstValueFrom(
        service.logAdminAction('admin-1', 'lockAccount', 'user-1')
      )
    ).rejects.toBe(error);

    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'admin-log',
      operation: 'logAdminAction',
      fallbackMessage: 'Falha ao registrar ação administrativa.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AdminLogService',
        action: 'lockAccount',
        targetUserUid: 'user-1',
      },
    });
  });

  it('permite feedback canônico quando a auditoria não é silenciosa', async () => {
    const error = new Error('write failed');
    writeMock.addDocument.mockReturnValue(throwError(() => error));

    await expect(
      firstValueFrom(
        service.logAdminAction(
          'admin-1',
          'unlockAccount',
          'user-1',
          undefined,
          { silent: false }
        )
      )
    ).rejects.toBe(error);

    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'admin-log',
      operation: 'logAdminAction',
      fallbackMessage: 'Falha ao registrar ação administrativa.',
      presentation: undefined,
      metadata: {
        scope: 'AdminLogService',
        action: 'unlockAccount',
        targetUserUid: 'user-1',
      },
    });
  });
});
