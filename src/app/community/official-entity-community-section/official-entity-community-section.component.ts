import {
  ChangeDetectionStrategy,
  Component,
  Input,
} from '@angular/core';

import type { CommunityOfficialTargetType } from 'src/app/core/community/community-official-association.model';
import { OfficialCommunitiesForTargetComponent } from '../official-communities-for-target/official-communities-for-target.component';

export type OfficialEntityCommunityTargetType = Exclude<
  CommunityOfficialTargetType,
  'profile'
>;

function normalizeEntityTargetType(
  value: unknown
): OfficialEntityCommunityTargetType | null {
  return value === 'organization' || value === 'venue' || value === 'event'
    ? value
    : null;
}

@Component({
  selector: 'app-official-entity-community-section',
  standalone: true,
  imports: [OfficialCommunitiesForTargetComponent],
  template: `
    @if (targetTypeValue && targetIdValue) {
      <app-official-communities-for-target
        [targetType]="targetTypeValue"
        [targetId]="targetIdValue"
        [currentCommunityId]="currentCommunityIdValue"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialEntityCommunitySectionComponent {
  targetTypeValue: OfficialEntityCommunityTargetType | null = null;
  targetIdValue = '';
  currentCommunityIdValue = '';

  @Input({ required: true })
  set targetType(
    value: OfficialEntityCommunityTargetType | null | undefined
  ) {
    this.targetTypeValue = normalizeEntityTargetType(value);
  }

  @Input({ required: true })
  set targetId(value: string | null | undefined) {
    this.targetIdValue = String(value ?? '').trim();
  }

  @Input()
  set currentCommunityId(value: string | null | undefined) {
    this.currentCommunityIdValue = String(value ?? '').trim();
  }
}
