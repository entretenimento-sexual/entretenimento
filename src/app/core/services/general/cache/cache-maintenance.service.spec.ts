import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { CacheMaintenanceService } from './cache-maintenance.service';
import { CacheMetricsService } from './cache-metrics.service';
import { CachePersistenceService } from './cache-persistence.service';

describe('CacheMaintenanceService', () => {
  const cleanupExpiredEntries = vi.fn();
  const handleError = vi.fn();
  const log = vi.fn();

  let service: CacheMaintenanceService;
  let metrics: CacheMetricsService;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('cache-maintenance:v1:cursor');
    sessionStorage.removeItem('cache-maintenance:v1:scheduled');

    cleanupExpiredEntries.mockReturnValue(
      of({
        totalKeys: 120,
        scanned: 40,
        removed: 3,
        invalid: 1,
        expired: 2,
        nextCursor: 40,
      })
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CachePersistenceService,
          useValue: { cleanupExpiredEntries },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log },
        },
      ],
    });

    service = TestBed.inject(CacheMaintenanceService);
    metrics = TestBed.inject(CacheMetricsService);
  });

  it('executa lote, persiste cursor e atualiza métricas', async () => {
    await expect(firstValueFrom(service.runCleanup$(40))).resolves.toMatchObject({
      scanned: 40,
      removed: 3,
      nextCursor: 40,
    });

    expect(cleanupExpiredEntries).toHaveBeenCalledWith({
      batchSize: 40,
      cursor: 0,
    });
    expect(localStorage.getItem('cache-maintenance:v1:cursor')).toBe('40');
    expect(metrics.snapshot().lastMaintenance).toMatchObject({
      scanned: 40,
      removed: 3,
      invalid: 1,
      expired: 2,
    });
  });

  it('encaminha falha ao handler global sem notificação de usuário', async () => {
    cleanupExpiredEntries.mockReturnValueOnce(
      throwError(() => new Error('indexeddb unavailable'))
    );

    await expect(firstValueFrom(service.runCleanup$())).resolves.toBeNull();

    expect(handleError).toHaveBeenCalledTimes(1);
    const error = handleError.mock.calls[0][0] as Error & {
      skipUserNotification?: boolean;
      context?: Record<string, unknown>;
    };
    expect(error.skipUserNotification).toBe(true);
    expect(error.context).toMatchObject({
      scope: 'CacheMaintenanceService',
      operation: 'cleanupExpiredEntries',
    });
  });
});
