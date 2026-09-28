import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import { PublicMediaBadgeComponent } from '../public-media-badge/public-media-badge.component';
import {
  PublicMediaRecommendationSource,
  resolvePublicMediaRecommendationContext,
} from '../../presentation/public-media-presentation.policy';

@Component({
  selector: 'app-public-media-recommendation-badge',
  standalone: true,
  imports: [PublicMediaBadgeComponent],
  templateUrl: './public-media-recommendation-badge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicMediaRecommendationBadgeComponent {
  readonly source = input<PublicMediaRecommendationSource>('unknown');
  readonly ownerUid = input<string | null>(null);
  readonly continuationContext =
    input<IPublicMediaContinuationContext | null>(null);

  readonly context = computed(() =>
    resolvePublicMediaRecommendationContext({
      source: this.source(),
      ownerUid: this.ownerUid(),
      continuationContext: this.continuationContext(),
    })
  );
}
