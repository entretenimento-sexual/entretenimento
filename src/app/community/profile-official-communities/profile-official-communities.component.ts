// src/app/community/profile-official-communities/profile-official-communities.component.ts
// -----------------------------------------------------------------------------
// PROFILE COMMUNITY RELATIONSHIPS
// -----------------------------------------------------------------------------
// Mantém a compatibilidade da superfície de Perfil, mas a associação oficial
// deixou de ser responsabilidade deste componente. Ela é delegada ao componente
// transversal OfficialCommunitiesForTargetComponent, que pode ser reutilizado
// por Perfil, Organização, Local e Evento.
// -----------------------------------------------------------------------------

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
  Subject,
  catchError,
  combineLatest,
  concat,
  distinctUntilChanged,
  exhaustMap,
  map,
  merge,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { normalizePublicProfileId } from 'src/app/core/domain/public-user-identity/public-profile-id.model';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import type {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
} from '../data-access/community-preview.model';
import { CommunityProfilePublicCommunitiesRepository } from '../data-access/community-profile-public-communities.repository';
import { OfficialCommunitiesForTargetComponent } from '../official-communities-for-target/official-communities-for-target.component';
import { getCommunitySocialSpaceAdapter } from '../presentation/community-social-space.adapter';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import {
  OFFICIAL_COMMUNITIES_FOR_TARGET_REASON_MESSAGES,
} from '../official-communities-for-target/official-communities-for-target-error.messages';

type ProfileMembershipStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ProfileMembershipVm {
  readonly status: ProfileMembershipStatus;
  readonly items: readonly CommunityPreviewCard[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
}

type ProfileMembershipLoadEvent =
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'loading-more' }>
  | Readonly<{
      type: 'success';
      page: CommunityDiscoveryPage;
      append: boolean;
    }>
  | Readonly<{ type: 'error'; append: boolean }>;

const PROFILE_COMMUNITY_LIMIT = 4;
const EMPTY_MEMBERSHIP_VM: ProfileMembershipVm = Object.freeze({
  status: 'empty',
  items: [],
  nextCursor: null,
  loadingMore: false,
});
const LOADING_MEMBERSHIP_VM: ProfileMembershipVm = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

function mergeMembershipCards(
  current: readonly CommunityPreviewCard[],
  incoming: readonly CommunityPreviewCard[]
): readonly CommunityPreviewCard[] {
  const byId = new Map<string, CommunityPreviewCard>();

  for (const item of current) byId.set(item.communityId, item);
  for (const item of incoming) byId.set(item.communityId, item);

  return [...byId.values()];
}

function reduceMembershipVm(
  state: ProfileMembershipVm,
  event: ProfileMembershipLoadEvent
): ProfileMembershipVm {
  if (event.type === 'loading') {
    return LOADING_MEMBERSHIP_VM;
  }

  if (event.type === 'loading-more') {
    return { ...state, loadingMore: true };
  }

  if (event.type === 'error') {
    return event.append
      ? { ...state, loadingMore: false }
      : {
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
        };
  }

  const items = event.append
    ? mergeMembershipCards(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

@Component({
  selector: 'app-profile-official-communities',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    ImageFallbackDirective,
    OfficialCommunitiesForTargetComponent,
  ],
  templateUrl: './profile-official-communities.component.html',
  styleUrl: './profile-official-communities.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileOfficialCommunitiesComponent {
  private readonly publicCommunitiesRepository = inject(
    CommunityProfilePublicCommunitiesRepository
  );
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly profileIdSubject = new BehaviorSubject<string>('');
  private readonly includePublicMembershipsSubject =
    new BehaviorSubject<boolean>(false);
  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly loadMoreSubject = new Subject<string>();

  profileIdValue = '';

  @Input({ required: true })
  set profileId(value: string | null | undefined) {
    const normalized = normalizePublicProfileId(value) ?? '';
    this.profileIdValue = normalized;
    this.profileIdSubject.next(normalized);
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

  readonly vm$: Observable<ProfileMembershipVm> = combineLatest([
    this.profileIdSubject.pipe(distinctUntilChanged()),
    this.includePublicMembershipsSubject.pipe(distinctUntilChanged()),
    this.refreshSubject,
  ]).pipe(
    switchMap(([profileId, includePublicMemberships]) => {
      if (!profileId || !includePublicMemberships) {
        return of(EMPTY_MEMBERSHIP_VM);
      }

      return this.loadPublicMembershipsPages$(profileId);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  loadMore(cursor: string | null): void {
    const normalizedCursor = String(cursor ?? '').trim();
    if (!normalizedCursor) return;

    this.loadMoreSubject.next(normalizedCursor);
  }

  detailsRoute(item: CommunityPreviewCard): readonly string[] {
    return getCommunitySocialSpaceAdapter(
      item.source.type
    ).discovery.detailsRoute(item.communityId, 'explore');
  }

  communityInitials(item: CommunityPreviewCard): string {
    return buildCommunityInitials(item);
  }

  communityVisualVariant(item: CommunityPreviewCard): number {
    return resolveCommunityVisualVariant(item);
  }

  private loadPublicMembershipsPages$(
    profileId: string
  ): Observable<ProfileMembershipVm> {
    const initial$ = this.loadPublicMembershipPageEvent$(
      profileId,
      null,
      false
    ).pipe(
      startWith<ProfileMembershipLoadEvent>({ type: 'loading' })
    );

    const additionalPages$ = this.loadMoreSubject.pipe(
      exhaustMap((cursor) =>
        concat(
          of<ProfileMembershipLoadEvent>({ type: 'loading-more' }),
          this.loadPublicMembershipPageEvent$(profileId, cursor, true)
        )
      )
    );

    return merge(initial$, additionalPages$).pipe(
      scan(reduceMembershipVm, LOADING_MEMBERSHIP_VM)
    );
  }

  private loadPublicMembershipPageEvent$(
    profileId: string,
    cursor: string | null,
    append: boolean
  ): Observable<ProfileMembershipLoadEvent> {
    return this.publicCommunitiesRepository.getProfilePublicCommunities$(
      profileId,
      PROFILE_COMMUNITY_LIMIT,
      cursor
    ).pipe(
      map((page): ProfileMembershipLoadEvent => ({
        type: 'success',
        page,
        append,
      })),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: append
            ? 'loadMoreProfilePublicCommunities'
            : 'loadProfilePublicCommunities',
          fallbackMessage: append
            ? 'Não foi possível carregar mais participações públicas agora.'
            : 'Não foi possível carregar as participações públicas deste perfil.',
          notification: 'warning',
          reasonMessages: OFFICIAL_COMMUNITIES_FOR_TARGET_REASON_MESSAGES,
          metadata: {
            scope: 'ProfileOfficialCommunitiesComponent',
            hasProfileId: true,
            publicMemberships: true,
            append,
          },
        });

        return of<ProfileMembershipLoadEvent>({ type: 'error', append });
      })
    );
  }
}
