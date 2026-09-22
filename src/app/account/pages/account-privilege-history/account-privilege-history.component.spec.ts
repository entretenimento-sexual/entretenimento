import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { AccountPrivilegeHistoryRepository } from '../../application/account-privilege-history.repository';
import { AccountPrivilegeHistoryComponent } from './account-privilege-history.component';

describe('AccountPrivilegeHistoryComponent', () => {
  const repositoryMock = {
    getMyHistory$: vi.fn(),
  };

  const applicationErrorMock = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getMyHistory$.mockReset();

    TestBed.configureTestingModule({
      imports: [AccountPrivilegeHistoryComponent],
      providers: [
        {
          provide: AccountPrivilegeHistoryRepository,
          useValue: repositoryMock,
        },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: of({ role: 'free' }) },
        },
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
      ],
    });

    TestBed.overrideComponent(AccountPrivilegeHistoryComponent, {
      set: { template: '' },
    });
  });

  it('mantém a falha do carregamento inicial silenciosa e centralizada', () => {
    const error = new Error('initial failure');
    repositoryMock.getMyHistory$.mockReturnValue(
      throwError(() => error)
    );

    const fixture = TestBed.createComponent(AccountPrivilegeHistoryComponent);

    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'account-privilege-history',
      operation: 'loadPrivilegeHistory',
      fallbackMessage: 'Não foi possível carregar o histórico de privilégios.',
      notification: 'none',
      metadata: {
        scope: 'AccountPrivilegeHistoryComponent',
      },
    });

    fixture.destroy();
  });

  it('usa a apresentação canônica de erro ao falhar em carregar mais', () => {
    const error = new Error('load more failure');
    repositoryMock.getMyHistory$
      .mockReturnValueOnce(of({ items: [], nextCursor: 'next' }))
      .mockReturnValueOnce(throwError(() => error));

    const fixture = TestBed.createComponent(AccountPrivilegeHistoryComponent);
    fixture.componentInstance.loadMore();

    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'account-privilege-history',
      operation: 'loadMorePrivilegeHistory',
      fallbackMessage: 'Não foi possível carregar registros mais antigos.',
      notification: 'error',
      metadata: {
        scope: 'AccountPrivilegeHistoryComponent',
      },
    });

    fixture.destroy();
  });
});
