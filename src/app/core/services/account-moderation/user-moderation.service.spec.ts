import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { AdminLogService } from './admin-log.service';
import { UserModerationService } from './user-moderation.service';

describe('UserModerationService', () => {
  const writeMock = {
    updateDocument: vi.fn(),
  };
  const adminLogMock = {
    logAdminAction: vi.fn(),
  };
  const applicationErrorMock = {
    report: vi.fn(),
  };
  const authMock: { currentUser: { uid: string } | null } = {
    currentUser: { uid: 'admin-1' },
  };

  let service: UserModerationService;

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.currentUser = { uid: 'admin-1' };
    adminLogMock.logAdminAction.mockReturnValue(of({}));

    TestBed.configureTestingModule({
      providers: [
        UserModerationService,
        { provide: Auth, useValue: authMock },
        { provide: FirestoreWriteService, useValue: writeMock },
        { provide: AdminLogService, useValue: adminLogMock },
        { provide: ApplicationErrorService, useValue: applicationErrorMock },
      ],
    });

    service = TestBed.inject(UserModerationService);
  });

  it('centraliza a ausência de admin autenticado sem acesso ao writer', async () => {
    authMock.currentUser = null;

    await expect(firstValueFrom(service.lockAccount('user-1'))).rejects.toMatchObject({
      code: 'auth/not-authenticated',
    });

    expect(writeMock.updateDocument).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'auth/not-authenticated',
        message: 'Sua sessão terminou. Entre novamente para continuar.',
      }),
      expect.objectContaining({ feature: 'account-moderation', operation: 'lockAccount' })
    );
  });

  it('centraliza falha da ação principal com feedback canônico', async () => {
    const error = new Error('write failed');
    writeMock.updateDocument.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(service.lockAccount('user-1'))).rejects.toBe(error);
    expect(adminLogMock.logAdminAction).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, expect.objectContaining({
      feature: 'account-moderation',
      operation: 'lockAccount',
      fallbackMessage: 'Não foi possível bloquear a conta.',
    }));
  });

  it('não duplica diagnóstico quando a auditoria best-effort falha', async () => {
    const auditError = new Error('audit failed');
    writeMock.updateDocument.mockReturnValue(of(void 0));
    adminLogMock.logAdminAction.mockReturnValue(
      throwError(() => auditError)
    );

    await firstValueFrom(service.lockAccount('user-1'));

    expect(writeMock.updateDocument).toHaveBeenCalledWith(
      'users',
      'user-1',
      {
        accountLocked: true,
        moderatedBy: 'admin-1',
        moderatedAt: expect.objectContaining({ _methodName: 'serverTimestamp' }),
      },
      { context: 'UserModerationService.lockAccount', silent: true }
    );
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
  });
});
