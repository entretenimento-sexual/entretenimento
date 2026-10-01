import { Injectable } from '@angular/core';

import {
  CommunityDistributionTelemetryService,
} from 'src/app/community/discovery/community-distribution-telemetry.service';
import type {
  CommunityDistributionTelemetrySurface,
} from 'src/app/community/data-access/community-distribution-telemetry.repository';
import { ExploreCommunityDistributionService } from '../services/explore-community-distribution.service';

@Injectable()
export class SocialExploreCommunityDistributionFacade {
  readonly vm$ = this.communityDistribution.vm$;

  constructor(
    private readonly communityDistribution: ExploreCommunityDistributionService,
    private readonly telemetry: CommunityDistributionTelemetryService
  ) {}

  recordExposure(
    communityId: string,
    surface: CommunityDistributionTelemetrySurface
  ): void {
    this.telemetry.recordQualifiedExposure(communityId, surface);
  }

  recordOpen(
    communityId: string,
    surface: CommunityDistributionTelemetrySurface
  ): void {
    this.telemetry.recordOpen(communityId, surface);
  }

  initials(name: string): string {
    return (
      String(name ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.slice(0, 1).toUpperCase())
        .join('') || '?'
    );
  }
}
