import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import { normalizePublicUserIdentity } from 'src/app/core/domain/public-user-identity/public-user-identity.model';

import type {
  CommunityExploreContentItem,
} from 'src/app/community/data-access/community-explore-content.model';

@Component({
  selector: 'app-explore-community-content-card',
  standalone: true,
  imports: [RouterLink, PublicUserIdentityComponent],
  templateUrl: './explore-community-content-card.component.html',
  styleUrl: './explore-community-content-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExploreCommunityContentCardComponent {
  readonly item = input.required<CommunityExploreContentItem>();
  readonly opened = output<string>();
  readonly authorIdentity = computed(() =>
    normalizePublicUserIdentity(this.item().post.author)
  );

  recordOpen(): void {
    this.opened.emit(this.item().communityId);
  }

  initials(label: string): string {
    return String(label ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join('') || '?';
  }
}
