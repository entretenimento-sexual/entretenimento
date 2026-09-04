// src/app/community/discovery/community-discovery-exposure.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityDiscoveryExposureRepository } from '../data-access/community-discovery-exposure.repository';
import { CommunityDiscoveryExposureService } from './community-discovery-exposure.service';

const BATCH_INTERVAL_MS = 1_200;
const INITIAL_RETRY_DELAY_MS = 60_000;

describe('CommunityDiscoveryExposureService', () => {
  const recordQualifiedExposure$ = vi.fn();
  const report = vi.fn();
  let viewerUid$: BehaviorSubject<string | null>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T20:00:00-03:00'));
    vi.clearAllMocks();
    viewerUid$ = new BehaviorSubject<string | null>('viewer-1');
    recordQualifiedExposure$.mockReturnValue(
      of({ accepted: 1, generatedAt: Date.now() })
    );

    TestBed.configureTestingModule({
      providers: [
        CommunityDiscoveryExposureService,
        {
          provide: AuthSessionService,
          useValue: { readyUid$: viewerUid$.asObservable() },
        },
        {
          provide: CommunityDiscoveryExposureRepository,
          useValue: { recordQualifiedExposure$ },
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

  it('deduplica a mesma Comunidade na sessão antes de enviar', async () => {
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    service.recordQualifiedExposure('community-1', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).toHaveBeenCalledOnce();
    expect(recordQualifiedExposure$).toHaveBeenCalledWith({
      sourceType: 'community',
      communityIds: ['community-1'],
    });
  });

  it('separa Comunidades e Locais no transporte', async () => {
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    service.recordQualifiedExposure('venue-community-1', 'venue');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).toHaveBeenNthCalledWith(1, {
      sourceType: 'community',
      communityIds: ['community-1'],
    });
    expect(recordQualifiedExposure$).toHaveBeenNthCalledWith(2, {
      sourceType: 'venue',
      communityIds: ['venue-community-1'],
    });
  });

  it('reinicia a deduplicação ao trocar o usuário autenticado', async () => {
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    viewerUid$.next('viewer-2');
    service.recordQualifiedExposure('community-1', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).toHaveBeenCalledTimes(2);
    expect(recordQualifiedExposure$).toHaveBeenNthCalledWith(2, {
      sourceType: 'community',
      communityIds: ['community-1'],
    });
  });

  it('descarta exposições em buffer pertencentes à sessão anterior', async () => {
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-old', 'community');
    viewerUid$.next('viewer-2');
    service.recordQualifiedExposure('community-new', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).toHaveBeenCalledOnce();
    expect(recordQualifiedExposure$).toHaveBeenCalledWith({
      sourceType: 'community',
      communityIds: ['community-new'],
    });
  });

  it('não registra telemetria sem sessão autenticada pronta', async () => {
    viewerUid$.next(null);
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).not.toHaveBeenCalled();
  });

  it('abre circuito após falha e evita novas tentativas durante o backoff', async () => {
    recordQualifiedExposure$.mockReturnValueOnce(
      throwError(() => new Error('functions unavailable'))
    );
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);

    service.recordQualifiedExposure('community-2', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);

    expect(recordQualifiedExposure$).toHaveBeenCalledTimes(1);
  });

  it('retoma após o backoff e reseta o circuito quando o backend volta', async () => {
    recordQualifiedExposure$
      .mockReturnValueOnce(throwError(() => new Error('temporary failure')))
      .mockReturnValue(of({ accepted: 1, generatedAt: Date.now() }));
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_DELAY_MS);

    service.recordQualifiedExposure('community-2', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);
    expect(recordQualifiedExposure$).toHaveBeenCalledTimes(2);

    service.recordQualifiedExposure('community-3', 'community');
    await vi.advanceTimersByTimeAsync(BATCH_INTERVAL_MS);
    expect(recordQualifiedExposure$).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
