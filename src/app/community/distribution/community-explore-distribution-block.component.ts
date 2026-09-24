// src/app/community/distribution/community-explore-distribution-block.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityDiscoveryVisibilityDirective } from '../discovery/community-discovery-visibility.directive';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import {
  communityInitials as buildCommunityInitials,
} from '../presentation/community-visual-identity';
import type { CommunityExploreActivitySummary } from './community-explore-distribution.service';

export type CommunityExploreDistributionBlockSlot =
  | 'activity'
  | 'recommendations';

@Component({
  selector: 'app-community-explore-distribution-block',
  standalone: true,
  imports: [
    RouterLink,
    ImageFallbackDirective,
    CommunityDiscoveryVisibilityDirective,
    CommunityOfficialBadgeComponent,
  ],
  templateUrl: './community-explore-distribution-block.component.html',
  styleUrl: './community-explore-distribution-block.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityExploreDistributionBlockComponent {
  @Input({ required: true })
  slot: CommunityExploreDistributionBlockSlot = 'recommendations';

  @Input()
  activity: CommunityExploreActivitySummary | null = null;

  @Input()
  recommendations: readonly CommunityPreviewCard[] = [];

  @Output()
  readonly recommendationDismissed = new EventEmitter<string>();

  @Output()
  readonly recommendationExposed = new EventEmitter<string>();

  communityInitials(item: CommunityPreviewCard): string {
    return buildCommunityInitials(item);
  }

  dismissRecommendation(
    item: CommunityPreviewCard,
    event: Event
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.recommendationDismissed.emit(item.communityId);
  }

  recordExposure(communityId: string): void {
    this.recommendationExposed.emit(communityId);
  }
}
