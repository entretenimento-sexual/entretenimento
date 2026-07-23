import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { CacheLegacyMigrationService } from './cache-legacy-migration.service';
import { CachePersistenceService } from './cache-persistence.service';

describe('CacheLegacyMigrationService', () => {
  let service: CacheLegacyMigrationService;
  let persistence: {
    deletePersistentByPrefixes: ReturnType<typeof vi.fn>;
  };
  let globalError: {
    handleError: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    persistence = {
      deletePersistentByPrefixes: vi.fn().mockReturnValue(of(2)),
    };
    globalError = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        CacheLegacyMigrationService,
        { provide: CachePersistenceService, useValue: persistence },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    service = TestBed.inject(CacheLegacyMigrationService);
  });

  it('executa a limpeza apenas uma vez por migrationId', async () => {
    await firstValueFrom(
      service.purgePrefixesOnce$('preferences-v1', [
        'preferences:',
        'preferences:',
      ])
    );
    await firstValueFrom(
      service.purgePrefixesOnce$('preferences-v1', ['preferences:'])
    );

    expect(persistence.deletePersistentByPrefixes).toHaveBeenCalledTimes(1);
    expect(persistence.deletePersistentByPrefixes).toHaveBeenCalledWith([
      'preferences:',
    ]);
  });

  it('não marca como concluída quando a persistência falha', async () => {
    persistence.deletePersistentByPrefixes
      .mockReturnValueOnce(throwError(() => new Error('idb unavailable')))
      .mockReturnValueOnce(of(1));

    await firstValueFrom(
      service.purgePrefixesOnce$('preferences-v2', ['preferences:'])
    );
    await firstValueFrom(
      service.purgePrefixesOnce$('preferences-v2', ['preferences:'])
    );

    expect(persistence.deletePersistentByPrefixes).toHaveBeenCalledTimes(2);
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });

  it('rejeita migrationId vazio', async () => {
    await expect(
      firstValueFrom(service.purgePrefixesOnce$(' ', ['preferences:']))
    ).rejects.toThrow('migrationId obrigatório');
  });
});
