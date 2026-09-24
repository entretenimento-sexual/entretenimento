// src/app/community/discovery/community-discovery-mine.facade.ts
import {
  DestroyRef,
  Injectable,
  Injector,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  Observable,
  catchError,
  defer,
  finalize,
  of,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityNotificationPreferenceService } from 'src/app/core/services/notifications/community-notification-preference.service';
import {
  CommunityNotificationUnreadSummary,
  CommunityNotificationUnreadSummaryService,
} from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import {
  CommunityAttentionGroupKey,
  resolveCommunityAttentionPresentation,
  resolveCommunityNotificationStatusPresentation,
} from '../presentation/community-ui.presentation';
import {
  CommunityMineParticipationFilter,
  filterMineCommunityItems,
} from './community-mine-participation.policy';

export type CommunityDiscoveryMineCardView = CommunityPreviewCard & {
  readonly notificationUnreadCount: number;
  readonly notificationHasPriorityUnread: boolean;
  readonly notificationUpdatedAt: number | null;
  readonly notificationsMuted: boolean;
};

export interface CommunityNotificationPreferenceFeedback {
  readonly communityId: string;
  readonly name: string;
  readonly muted: boolean;
}

const EMPTY_NOTIFICATION_SUMMARY_MAP: ReadonlyMap<
  string,
  CommunityNotificationUnreadSummary
> = new Map<string, CommunityNotificationUnreadSummary>();
const EMPTY_MUTED_COMMUNITY_IDS: ReadonlySet<string> = new Set<string>();

function attentionGroupKey(
  item: CommunityDiscoveryMineCardView
): CommunityAttentionGroupKey {
  return resolveCommunityAttentionPresentation(
    item.notificationUnreadCount,
    item.notificationHasPriorityUnread
  ).key;
}

function attentionRank(item: CommunityDiscoveryMineCardView): number {
  const group = attentionGroupKey(item);
  if (group === 'priority') return 0;
  if (group === 'unread') return 1;
  return 2;
}

export function orderMineCommunityCardsByAttention(
  items: readonly CommunityDiscoveryMineCardView[]
): readonly CommunityDiscoveryMineCardView[] {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const leftRank = attentionRank(left.item);
      const rightRank = attentionRank(right.item);
      const rankDifference = leftRank - rightRank;

      if (rankDifference !== 0) return rankDifference;

      if (leftRank < 2) {
        const updatedAtDifference =
          (right.item.notificationUpdatedAt ?? 0)
          - (left.item.notificationUpdatedAt ?? 0);
        if (updatedAtDifference !== 0) return updatedAtDifference;

        const unreadDifference =
          right.item.notificationUnreadCount
          - left.item.notificationUnreadCount;
        if (unreadDifference !== 0) return unreadDifference;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
}

@Injectable()
export class CommunityDiscoveryMineFacade {
  private readonly injector = inject(Injector);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchTermSubject = new BehaviorSubject<string>('');
  private readonly participationFilterSubject =
    new BehaviorSubject<CommunityMineParticipationFilter>('all');

  readonly searchTerm$ = this.searchTermSubject.asObservable();
  readonly participationFilter$ = this.participationFilterSubject.asObservable();
  readonly notificationPreferenceBusyCommunityIds = signal<ReadonlySet<string>>(
    new Set<string>()
  );
  readonly notificationPreferenceFeedback =
    signal<CommunityNotificationPreferenceFeedback | null>(null);

  unreadSummaryMap$(
    enabled: boolean
  ): Observable<ReadonlyMap<string, CommunityNotificationUnreadSummary>> {
    return enabled
      ? defer(() =>
          this.injector.get(CommunityNotificationUnreadSummaryService)
            .currentUserSummaryMap$
        )
      : of(EMPTY_NOTIFICATION_SUMMARY_MAP);
  }

  mutedCommunityIds$(enabled: boolean): Observable<ReadonlySet<string>> {
    return enabled
      ? defer(() =>
          this.injector.get(CommunityNotificationPreferenceService)
            .currentUserMutedCommunityIds$
        )
      : of(EMPTY_MUTED_COMMUNITY_IDS);
  }

  decorateCards(
    items: readonly CommunityPreviewCard[],
    unreadSummaryMap: ReadonlyMap<string, CommunityNotificationUnreadSummary>,
    mutedCommunityIds: ReadonlySet<string>
  ): readonly CommunityDiscoveryMineCardView[] {
    return items.map((item): CommunityDiscoveryMineCardView => {
      const summary =
        unreadSummaryMap.get(item.communityId)
        ?? item.viewerNotificationSummary
        ?? null;

      return {
        ...item,
        notificationUnreadCount: summary?.unreadCount ?? 0,
        notificationHasPriorityUnread: summary?.hasPriorityUnread ?? false,
        notificationUpdatedAt: summary?.updatedAt ?? null,
        notificationsMuted: mutedCommunityIds.has(item.communityId),
      };
    });
  }

  filterAndOrder(
    items: readonly CommunityDiscoveryMineCardView[],
    participationFilter: CommunityMineParticipationFilter,
    searchTerm: string
  ): readonly CommunityDiscoveryMineCardView[] {
    return orderMineCommunityCardsByAttention(
      filterMineCommunityItems(items, participationFilter, searchTerm)
    );
  }

  attentionGroupKey(
    item: CommunityDiscoveryMineCardView
  ): CommunityAttentionGroupKey {
    return attentionGroupKey(item);
  }

  attentionGroupPresentation(item: CommunityDiscoveryMineCardView) {
    return resolveCommunityAttentionPresentation(
      item.notificationUnreadCount,
      item.notificationHasPriorityUnread
    );
  }

  notificationStatusPresentation(item: CommunityDiscoveryMineCardView) {
    return resolveCommunityNotificationStatusPresentation(
      item.notificationUnreadCount,
      item.notificationHasPriorityUnread,
      item.notificationsMuted
    );
  }

  notificationUnreadAriaLabel(item: CommunityDiscoveryMineCardView): string {
    const priority = item.notificationHasPriorityUnread
      ? ', incluindo atividade prioritária'
      : '';

    return `${item.notificationUnreadCount} atividades não lidas${priority}`;
  }

  startsAttentionGroup(
    items: readonly CommunityDiscoveryMineCardView[],
    index: number
  ): boolean {
    const item = items[index];
    if (!item) return false;

    const previous = index > 0 ? items[index - 1] : null;
    return !previous
      || attentionGroupKey(previous) !== attentionGroupKey(item);
  }

  selectParticipationFilter(
    filter: CommunityMineParticipationFilter
  ): void {
    if (this.participationFilterSubject.value === filter) return;
    this.participationFilterSubject.next(filter);
  }

  isParticipationFilterSelected(
    filter: CommunityMineParticipationFilter
  ): boolean {
    return this.participationFilterSubject.value === filter;
  }

  setSearchTerm(value: string): void {
    if (this.searchTermSubject.value === value) return;
    this.searchTermSubject.next(value);
  }

  changeSearch(event: Event): void {
    const value = event.target instanceof HTMLInputElement
      ? event.target.value.slice(0, 80)
      : '';
    this.setSearchTerm(value);
  }

  searchValue(): string {
    return this.searchTermSubject.value;
  }

  clearControls(): void {
    if (this.searchTermSubject.value) {
      this.searchTermSubject.next('');
    }
    if (this.participationFilterSubject.value !== 'all') {
      this.participationFilterSubject.next('all');
    }
  }

  isNotificationPreferenceBusy(communityId: string): boolean {
    return this.notificationPreferenceBusyCommunityIds().has(communityId);
  }

  toggleNotifications(
    item: CommunityDiscoveryMineCardView,
    metadata: Readonly<Record<string, unknown>>,
    enabled: boolean
  ): void {
    if (!enabled || this.isNotificationPreferenceBusy(item.communityId)) return;

    const nextMuted = !item.notificationsMuted;
    this.notificationPreferenceFeedback.set(null);
    this.setNotificationPreferenceBusy(item.communityId, true);

    this.injector.get(CommunityNotificationPreferenceService)
      .updateMuted$(item.communityId, nextMuted)
      .pipe(
        tap((result) => {
          this.notificationPreferenceFeedback.set({
            communityId: result.communityId,
            name: item.name,
            muted: result.muted,
          });
        }),
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'community',
            operation: 'updateCommunityNotificationPreference',
            fallbackMessage: nextMuted
              ? 'Não foi possível silenciar os alertas desta Comunidade.'
              : 'Não foi possível reativar os alertas desta Comunidade.',
            metadata: {
              ...metadata,
              scope: 'CommunityDiscoveryMineFacade',
              communityId: item.communityId,
              muted: nextMuted,
            },
          });
          return of(null);
        }),
        finalize(() =>
          this.setNotificationPreferenceBusy(item.communityId, false)
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private setNotificationPreferenceBusy(
    communityId: string,
    busy: boolean
  ): void {
    const next = new Set(this.notificationPreferenceBusyCommunityIds());

    if (busy) {
      next.add(communityId);
    } else {
      next.delete(communityId);
    }

    this.notificationPreferenceBusyCommunityIds.set(next);
  }
}
