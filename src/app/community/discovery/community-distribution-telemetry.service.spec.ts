import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityDistributionTelemetryRepository } from '../data-access/community-distribution-telemetry.repository';
import { CommunityDistributionTelemetryService } from './community-distribution-telemetry.service';

const BATCH_INTERVAL_MS = 1_200;
const INITIAL_RETRY_DELAY_MS = 60_000;

describe('CommunityDistributionTelemetryService', () => {
  const recordEvents$ = vi.fn();
  const report = vi.fn();
  let viewerUid$: BehaviorSubject<string | null>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T08:00:00-03:00'));
    vi.clearAllMocks();
    viewerUid$ = new BehaviorSubject<string | null>('viewer-1');
    recordEvents$.mockReturnValue(
      of({ accepted: 1, generatedAt: Date.now() })
    );

    TestBed.configureTestingModule({
      providers: [
        CommunityDistributionTelemetryService,
        {
          provide: AuthSessionService,
          useValue: { readyUid$: viewerUid$.asObservable() },
        },
        {
          provide: CommunityDistributionTelemetryRepository,
          useValue: { recordEvents$ },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    viewerUid$.complete();
    vi.useRealTimers();
  });

  it('agrupa exposição e abertura em uma única chamada', async () => {
    const service = TestBed.inject(CommunityDistributionTelemetryService);

    service.recordQualifiedExposure(
      'community-1',
      'social_explore_recommendation'
    );
    service.recordOpen('community-1', 'social_explore_recommendation');

    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordEvents$).toHaveBeenCalledOnce();
    expect(recordEvents$).toHaveBeenCalledWith([
      {
        communityId: 'community-1',
        surface: 'social_explore_recommendation',
        eventType: 'qualified_exposure',
      },
      {
        communityId: 'community-1',
        surface: 'social_explore_recommendation',
        eventType: 'open',
      },
    ]);
  });

  it('deduplica por sessão sem misturar superfícies', async () => {
    const service = TestBed.inject(CommunityDistributionTelemetryService);

    service.recordQualifiedExposure(
      'community-1',
      'social_explore_recommendation'
    );
    service.recordQualifiedExposure(
      'community-1',
      'social_explore_recommendation'
    );
    service.recordQualifiedExposure(
      'community-1',
      'social_explore_content'
    );

    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordEvents$).toHaveBeenCalledOnce();
    expect(recordEvents$).toHaveBeenCalledWith([
      {
        communityId: 'community-1',
        surface: 'social_explore_recommendation',
        eventType: 'qualified_exposure',
      },
      {
        communityId: 'community-1',
        surface: 'social_explore_content',
        eventType: 'qualified_exposure',
      },
    ]);
  });

  it('descarta buffer antigo ao trocar de viewer', async () => {
    const service = TestBed.inject(CommunityDistributionTelemetryService);

    service.recordQualifiedExposure(
      'community-old',
      'social_explore_content'
    );
    viewerUid$.next('viewer-2');
    service.recordQualifiedExposure(
      'community-new',
      'social_explore_content'
    );

    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordEvents$).toHaveBeenCalledOnce();
    expect(recordEvents$).toHaveBeenCalledWith([
      {
        communityId: 'community-new',
        surface: 'social_explore_content',
        eventType: 'qualified_exposure',
      },
    ]);
  });

  it('aplica circuito de backoff sem interromper navegação', async () => {
    recordEvents$.mockReturnValueOnce(
      throwError(() => new Error('telemetry unavailable'))
    );
    const service = TestBed.inject(CommunityDistributionTelemetryService);

    service.recordOpen('community-1', 'social_explore_content');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    service.recordOpen('community-2', 'social_explore_content');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordEvents$).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_DELAY_MS);
    service.recordOpen('community-3', 'social_explore_content');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordEvents$).toHaveBeenCalledTimes(2);
  });
});
