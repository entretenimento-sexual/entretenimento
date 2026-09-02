// src/app/community/discovery/community-discovery-exposure.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityDiscoveryExposureRepository } from '../data-access/community-discovery-exposure.repository';
import { CommunityDiscoveryExposureService } from './community-discovery-exposure.service';

describe('CommunityDiscoveryExposureService', () => {
  const recordQualifiedExposure$ = vi.fn();
  const report = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    recordQualifiedExposure$.mockReturnValue(
      of({ accepted: 1, generatedAt: 123 })
    );

    TestBed.configureTestingModule({
      providers: [
        CommunityDiscoveryExposureService,
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
    vi.useRealTimers();
  });

  it('deduplica a mesma Comunidade na sessão antes de enviar', () => {
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    service.recordQualifiedExposure('community-1', 'community');
    vi.advanceTimersByTime(1_200);

    expect(recordQualifiedExposure$).toHaveBeenCalledOnce();
    expect(recordQualifiedExposure$).toHaveBeenCalledWith({
      sourceType: 'community',
      communityIds: ['community-1'],
    });
  });

  it('separa Comunidades e Locais no transporte', () => {
    const service = TestBed.inject(CommunityDiscoveryExposureService);

    service.recordQualifiedExposure('community-1', 'community');
    service.recordQualifiedExposure('venue-community-1', 'venue');
    vi.advanceTimersByTime(1_200);

    expect(recordQualifiedExposure$).toHaveBeenNthCalledWith(1, {
      sourceType: 'community',
      communityIds: ['community-1'],
    });
    expect(recordQualifiedExposure$).toHaveBeenNthCalledWith(2, {
      sourceType: 'venue',
      communityIds: ['venue-community-1'],
    });
  });
});
