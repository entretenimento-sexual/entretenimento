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
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { normalizePublicProfileId } from 'src/app/core/domain/public-user-identity/public-profile-id.model';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { COMMUNITY_ERROR_PRESENTATION_CONTEXTS } from '../presentation/community-error.catalog';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityProfilePublicCommunitiesRepository } from '../data-access/community-profile-public-communities.repository';
import { OfficialCommunitiesForTargetComponent } from '../official-communities-for-target/official-communities-for-target.component';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import {
  PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES,
} from './profile-official-communities-error.messages';

type ProfileMembershipStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ProfileMembershipVm {
  readonly status: ProfileMembershipStatus;
  readonly items: readonly CommunityPreviewCard[];
}

const PROFILE_COMMUNITY_LIMIT = 4;
const EMPTY_MEMBERSHIP_VM: ProfileMembershipVm = Object.freeze({
  status: 'empty',
  items: [],
});

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

      return this.loadPublicMemberships$(profileId);
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

  private loadPublicMemberships$(
    profileId: string
  ): Observable<ProfileMembershipVm> {
    return this.publicCommunitiesRepository.getProfilePublicCommunities$(
      profileId,
      PROFILE_COMMUNITY_LIMIT
    ).pipe(
      map((page) => ({
        status: page.items.length > 0 ? 'ready' : 'empty',
        items: page.items,
      } as ProfileMembershipVm)),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'loadProfilePublicCommunities',
          fallbackMessage:
            'Não foi possível carregar as participações públicas deste perfil.',
          communityPresentationContext:
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.WARNING_NON_BLOCKING,
          reasonMessages: PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES,
          metadata: {
            scope: 'ProfileOfficialCommunitiesComponent',
            hasProfileId: true,
            publicMemberships: true,
          },
        });

        return of({
          status: 'error',
          items: [],
        } as ProfileMembershipVm);
      }),
      startWith({
        status: 'loading',
        items: [],
      } as ProfileMembershipVm)
    );
  }
}
