// src/app/community/profile-official-communities/profile-official-communities.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityProfilePublicCommunitiesRepository } from '../data-access/community-profile-public-communities.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import {
  PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES,
} from './profile-official-communities-error.messages';

type ProfileOfficialCommunitiesStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

interface ProfileOfficialCommunitiesVm {
  status: ProfileOfficialCommunitiesStatus;
  items: readonly CommunityPreviewCard[];
  combined: boolean;
}

interface ProfileCommunityLoadResult {
  readonly items: readonly CommunityPreviewCard[];
  readonly failed: boolean;
}

const PROFILE_COMMUNITY_LIMIT = 4;
const EMPTY_VM: ProfileOfficialCommunitiesVm = Object.freeze({
  status: 'empty',
  items: [],
  combined: false,
});

export function mergeProfileCommunityCards(
  official: readonly CommunityPreviewCard[],
  publicMemberships: readonly CommunityPreviewCard[],
  limit = PROFILE_COMMUNITY_LIMIT
): readonly CommunityPreviewCard[] {
  const byCommunityId = new Map<string, CommunityPreviewCard>();

  for (const item of official) {
    if (!item?.communityId || byCommunityId.has(item.communityId)) continue;
    byCommunityId.set(item.communityId, item);
  }

  for (const item of publicMemberships) {
    if (!item?.communityId || byCommunityId.has(item.communityId)) continue;
    byCommunityId.set(item.communityId, item);
  }

  return [...byCommunityId.values()].slice(0, Math.max(1, Math.trunc(limit)));
}

@Component({
  selector: 'app-profile-official-communities',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    ImageFallbackDirective,
    CommunityOfficialBadgeComponent,
  ],
  templateUrl: './profile-official-communities.component.html',
  styleUrl: './profile-official-communities.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileOfficialCommunitiesComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly publicCommunitiesRepository = inject(
    CommunityProfilePublicCommunitiesRepository
  );
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly profileIdSubject = new BehaviorSubject<string>('');
  private readonly refreshSubject = new BehaviorSubject<number>(0);

  @Input({ required: true })
  set profileId(value: string | null | undefined) {
    this.profileIdSubject.next(String(value ?? '').trim().toLowerCase());
  }

  readonly vm$: Observable<ProfileOfficialCommunitiesVm> = combineLatest([
    this.profileIdSubject.pipe(distinctUntilChanged()),
    this.refreshSubject,
  ]).pipe(
    switchMap(([profileId]) => {
      if (!profileId) return of(EMPTY_VM);

      return combineLatest([
        this.loadOfficial$(profileId),
        this.loadPublicMemberships$(profileId),
      ]).pipe(
        map(([official, publicMemberships]): ProfileOfficialCommunitiesVm => {
          const items = mergeProfileCommunityCards(
            official.items,
            publicMemberships.items,
            PROFILE_COMMUNITY_LIMIT
          );
          const allSourcesFailed = official.failed && publicMemberships.failed;

          return {
            status: items.length > 0
              ? 'ready'
              : allSourcesFailed
                ? 'error'
                : 'empty',
            items,
            combined: true,
          };
        }),
        startWith<ProfileOfficialCommunitiesVm>({
          status: 'loading',
          items: [],
          combined: true,
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  detailsRoute(item: CommunityPreviewCard): readonly string[] {
    return item.source.type === 'venue'
      ? ['/dashboard/locais', item.communityId]
      : ['/dashboard/comunidades', item.communityId];
  }

  communityInitials(item: CommunityPreviewCard): string {
    return buildCommunityInitials(item);
  }

  communityVisualVariant(item: CommunityPreviewCard): number {
    return resolveCommunityVisualVariant(item);
  }

  private loadOfficial$(profileId: string): Observable<ProfileCommunityLoadResult> {
    return this.repository.getProfileOfficialCommunities$(
      profileId,
      PROFILE_COMMUNITY_LIMIT
    ).pipe(
      map((page) => ({ items: page.items, failed: false })),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'loadProfileOfficialCommunities',
          fallbackMessage:
            'Não foi possível carregar as comunidades oficiais deste perfil.',
          notification: 'warning',
          reasonMessages: PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES,
          metadata: {
            scope: 'ProfileOfficialCommunitiesComponent',
            hasProfileId: true,
          },
        });
        return of<ProfileCommunityLoadResult>({ items: [], failed: true });
      })
    );
  }

  private loadPublicMemberships$(
    profileId: string
  ): Observable<ProfileCommunityLoadResult> {
    return this.publicCommunitiesRepository.getProfilePublicCommunities$(
      profileId,
      PROFILE_COMMUNITY_LIMIT
    ).pipe(
      map((page) => ({ items: page.items, failed: false })),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'loadProfilePublicCommunities',
          fallbackMessage:
            'Não foi possível carregar as comunidades públicas deste perfil.',
          notification: 'warning',
          reasonMessages: PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES,
          metadata: {
            scope: 'ProfileOfficialCommunitiesComponent',
            hasProfileId: true,
          },
        });
        return of<ProfileCommunityLoadResult>({ items: [], failed: true });
      })
    );
  }
}
