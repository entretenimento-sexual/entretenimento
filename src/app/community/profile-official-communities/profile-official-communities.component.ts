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

type ProfileCommunitySectionStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

type ProfileCommunitySectionKind = 'membership' | 'official';

interface ProfileCommunitySectionVm {
  readonly kind: ProfileCommunitySectionKind;
  readonly status: ProfileCommunitySectionStatus;
  readonly items: readonly CommunityPreviewCard[];
}

interface ProfileCommunitiesVm {
  readonly sections: readonly ProfileCommunitySectionVm[];
  readonly visible: boolean;
}

const PROFILE_COMMUNITY_LIMIT = 4;

function sectionVm(
  kind: ProfileCommunitySectionKind,
  status: ProfileCommunitySectionStatus,
  items: readonly CommunityPreviewCard[] = []
): ProfileCommunitySectionVm {
  return { kind, status, items };
}

const EMPTY_VM: ProfileCommunitiesVm = Object.freeze({
  sections: [
    sectionVm('membership', 'empty'),
    sectionVm('official', 'empty'),
  ],
  visible: false,
});

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
  private readonly includePublicMembershipsSubject =
    new BehaviorSubject<boolean>(false);
  private readonly refreshSubject = new BehaviorSubject<number>(0);

  @Input({ required: true })
  set profileId(value: string | null | undefined) {
    this.profileIdSubject.next(String(value ?? '').trim().toLowerCase());
  }

  /**
   * O perfil próprio mantém esta opção desligada porque já possui a superfície
   * "Minhas comunidades". O perfil alheio habilita somente a projeção pública
   * opt-in, sem transformar participação em associação oficial.
   */
  @Input()
  set includePublicMemberships(value: boolean | null | undefined) {
    this.includePublicMembershipsSubject.next(value === true);
  }

  readonly vm$: Observable<ProfileCommunitiesVm> = combineLatest([
    this.profileIdSubject.pipe(distinctUntilChanged()),
    this.includePublicMembershipsSubject.pipe(distinctUntilChanged()),
    this.refreshSubject,
  ]).pipe(
    switchMap(([profileId, includePublicMemberships]) => {
      if (!profileId) return of(EMPTY_VM);

      const official$ = this.loadOfficial$(profileId);
      const membership$ = includePublicMemberships
        ? this.loadPublicMemberships$(profileId)
        : of(sectionVm('membership', 'empty'));

      return combineLatest([membership$, official$]).pipe(
        map(([membership, official]): ProfileCommunitiesVm => {
          const sections = [membership, official] as const;
          return {
            sections,
            visible: sections.some((section) => section.status !== 'empty'),
          };
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

  private loadOfficial$(
    profileId: string
  ): Observable<ProfileCommunitySectionVm> {
    return this.repository.getProfileOfficialCommunities$(
      profileId,
      PROFILE_COMMUNITY_LIMIT
    ).pipe(
      map((page) => sectionVm(
        'official',
        page.items.length > 0 ? 'ready' : 'empty',
        page.items
      )),
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
        return of(sectionVm('official', 'error'));
      }),
      startWith(sectionVm('official', 'loading'))
    );
  }

  private loadPublicMemberships$(
    profileId: string
  ): Observable<ProfileCommunitySectionVm> {
    return this.publicCommunitiesRepository.getProfilePublicCommunities$(
      profileId,
      PROFILE_COMMUNITY_LIMIT
    ).pipe(
      map((page) => sectionVm(
        'membership',
        page.items.length > 0 ? 'ready' : 'empty',
        page.items
      )),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'loadProfilePublicCommunities',
          fallbackMessage:
            'Não foi possível carregar as participações públicas deste perfil.',
          notification: 'warning',
          reasonMessages: PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES,
          metadata: {
            scope: 'ProfileOfficialCommunitiesComponent',
            hasProfileId: true,
            publicMemberships: true,
          },
        });
        return of(sectionVm('membership', 'error'));
      }),
      startWith(sectionVm('membership', 'loading'))
    );
  }
}
