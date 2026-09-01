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
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';

type ProfileOfficialCommunitiesStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

interface ProfileOfficialCommunitiesVm {
  status: ProfileOfficialCommunitiesStatus;
  items: readonly CommunityPreviewCard[];
}

const EMPTY_VM: ProfileOfficialCommunitiesVm = Object.freeze({
  status: 'empty',
  items: [],
});

@Component({
  selector: 'app-profile-official-communities',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ImageFallbackDirective],
  templateUrl: './profile-official-communities.component.html',
  styleUrl: './profile-official-communities.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileOfficialCommunitiesComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly profileUidSubject = new BehaviorSubject<string>('');
  private readonly refreshSubject = new BehaviorSubject<number>(0);

  @Input({ required: true })
  set profileUid(value: string | null | undefined) {
    this.profileUidSubject.next(String(value ?? '').trim());
  }

  readonly vm$: Observable<ProfileOfficialCommunitiesVm> = combineLatest([
    this.profileUidSubject.pipe(distinctUntilChanged()),
    this.refreshSubject,
  ]).pipe(
    switchMap(([profileUid]) => {
      if (!profileUid) return of(EMPTY_VM);

      return this.repository
        .getProfileOfficialCommunities$(profileUid, 4)
        .pipe(
          map((page): ProfileOfficialCommunitiesVm => ({
            status: page.items.length > 0 ? 'ready' : 'empty',
            items: page.items,
          })),
          catchError((error: unknown) => {
            this.applicationError.report(error, {
              feature: 'community',
              operation: 'loadProfileOfficialCommunities',
              fallbackMessage:
                'Não foi possível carregar as comunidades oficiais deste perfil.',
              notification: 'warning',
              metadata: {
                scope: 'ProfileOfficialCommunitiesComponent',
                hasProfileUid: true,
              },
            });

            return of<ProfileOfficialCommunitiesVm>({
              status: 'error',
              items: [],
            });
          }),
          startWith<ProfileOfficialCommunitiesVm>({
            status: 'loading',
            items: [],
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
}
