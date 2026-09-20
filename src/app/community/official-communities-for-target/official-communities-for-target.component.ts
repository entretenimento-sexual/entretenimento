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

import type { CommunityOfficialTargetType } from 'src/app/core/community/community-official-association.model';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import {
  OFFICIAL_COMMUNITIES_FOR_TARGET_REASON_MESSAGES,
} from './official-communities-for-target-error.messages';

type OfficialCommunitiesStatus = 'loading' | 'ready' | 'empty' | 'error';

interface OfficialTargetCopy {
  readonly context: string;
  readonly ariaLabel: string;
  readonly currentAssociationLabel: string;
}

interface OfficialCommunitiesForTargetVm {
  readonly status: OfficialCommunitiesStatus;
  readonly items: readonly CommunityPreviewCard[];
  readonly context: string;
  readonly ariaLabel: string;
  readonly currentAssociationLabel: string;
  readonly visible: boolean;
}

const OFFICIAL_COMMUNITY_LIMIT = 4;

const TARGET_COPY: Readonly<Record<CommunityOfficialTargetType, OfficialTargetCopy>> =
  Object.freeze({
    profile: {
      context: 'Associação oficial verificada para este perfil.',
      ariaLabel: 'Comunidade oficialmente vinculada a este perfil',
      currentAssociationLabel: 'Esta é a comunidade oficial deste perfil',
    },
    organization: {
      context: 'Associação oficial verificada para esta organização.',
      ariaLabel: 'Comunidade oficialmente vinculada a esta organização',
      currentAssociationLabel:
        'Esta é a comunidade oficial desta organização',
    },
    venue: {
      context: 'Associação oficial verificada para este local.',
      ariaLabel: 'Comunidade oficialmente vinculada a este local',
      currentAssociationLabel: 'Esta é a comunidade oficial deste Local',
    },
    event: {
      context: 'Associação oficial verificada para este evento.',
      ariaLabel: 'Comunidade oficialmente vinculada a este evento',
      currentAssociationLabel: 'Esta é a comunidade oficial deste evento',
    },
  });

function normalizeTargetType(
  value: unknown
): CommunityOfficialTargetType | null {
  return value === 'profile'
    || value === 'organization'
    || value === 'venue'
    || value === 'event'
    ? value
    : null;
}

function buildVm(
  targetType: CommunityOfficialTargetType,
  status: OfficialCommunitiesStatus,
  items: readonly CommunityPreviewCard[] = []
): OfficialCommunitiesForTargetVm {
  const copy = TARGET_COPY[targetType];

  return {
    status,
    items,
    context: copy.context,
    ariaLabel: copy.ariaLabel,
    currentAssociationLabel: copy.currentAssociationLabel,
    visible: status !== 'empty',
  };
}

@Component({
  selector: 'app-official-communities-for-target',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    ImageFallbackDirective,
    CommunityOfficialBadgeComponent,
  ],
  templateUrl: './official-communities-for-target.component.html',
  styleUrl: './official-communities-for-target.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialCommunitiesForTargetComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly targetTypeSubject =
    new BehaviorSubject<CommunityOfficialTargetType | null>(null);
  private readonly targetIdSubject = new BehaviorSubject<string>('');
  private readonly refreshSubject = new BehaviorSubject<number>(0);
  currentCommunityIdValue = '';

  @Input({ required: true })
  set targetType(value: CommunityOfficialTargetType | null | undefined) {
    this.targetTypeSubject.next(normalizeTargetType(value));
  }

  @Input({ required: true })
  set targetId(value: string | null | undefined) {
    this.targetIdSubject.next(String(value ?? '').trim());
  }

  @Input()
  set currentCommunityId(value: string | null | undefined) {
    this.currentCommunityIdValue = String(value ?? '').trim();
  }

  readonly vm$: Observable<OfficialCommunitiesForTargetVm | null> =
    combineLatest([
      this.targetTypeSubject.pipe(distinctUntilChanged()),
      this.targetIdSubject.pipe(distinctUntilChanged()),
      this.refreshSubject,
    ]).pipe(
      switchMap(([targetType, targetId]) => {
        if (!targetType || !targetId) return of(null);

        return this.repository.getOfficialCommunitiesForTarget$(
          { type: targetType, id: targetId },
          OFFICIAL_COMMUNITY_LIMIT
        ).pipe(
          map((page) => buildVm(
            targetType,
            page.items.length > 0 ? 'ready' : 'empty',
            page.items
          )),
          catchError((error: unknown) => {
            this.applicationError.report(error, {
              feature: 'community',
              operation: 'loadOfficialCommunitiesForTarget',
              fallbackMessage:
                'Não foi possível carregar a associação oficial desta entidade.',
              notification: 'warning',
              reasonMessages: OFFICIAL_COMMUNITIES_FOR_TARGET_REASON_MESSAGES,
              metadata: {
                scope: 'OfficialCommunitiesForTargetComponent',
                targetType,
                hasTargetId: true,
              },
            });

            return of(buildVm(targetType, 'error'));
          }),
          startWith(buildVm(targetType, 'loading'))
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  isCurrentCommunity(item: CommunityPreviewCard): boolean {
    return !!this.currentCommunityIdValue
      && item.communityId === this.currentCommunityIdValue;
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
