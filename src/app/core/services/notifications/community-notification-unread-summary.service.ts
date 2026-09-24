// src/app/core/services/notifications/community-notification-unread-summary.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION UNREAD SUMMARY SERVICE
// -----------------------------------------------------------------------------
// Hot path O(1): um único listener no documento global do usuário.
// A subcoleção /items não é mais observada integralmente; detalhe por Comunidade
// é anexado às páginas privadas de "Minhas Comunidades".
//
// Exceção bounded: ao sair voluntariamente de uma Comunidade, um listener
// temporário de UM item acompanha a convergência do backend para preservar o
// feedback imediato sem reintroduzir N listeners permanentes.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Firestore,
  doc,
  docData,
} from '@angular/fire/firestore';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  isFirebasePermissionDeniedError,
} from 'src/app/core/utils/firebase-error-utils';
import {
  applyCommunitySocialUnreadSuppressions,
} from './community-notification-unread-summary.local';

export interface CommunityNotificationUnreadSummary {
  readonly communityId: string;
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly hasPriorityUnread: boolean;
  readonly updatedAt: number | null;
}

export interface CommunityNotificationGlobalSummary {
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly unreadCommunityCount: number;
  readonly priorityCommunityCount: number;
  readonly hasPriorityUnread: boolean;
  readonly attentionWindow: readonly CommunityNotificationUnreadSummary[];
  readonly updatedAt: number | null;
  readonly ready: boolean;
}

interface CommunityNotificationGlobalSummaryDocument {
  projectionVersion?: unknown;
  requiresBackfill?: unknown;
  unreadCount?: unknown;
  priorityUnreadCount?: unknown;
  unreadCommunityCount?: unknown;
  priorityCommunityCount?: unknown;
  hasPriorityUnread?: unknown;
  attentionWindow?: unknown;
  updatedAt?: unknown;
}

interface CommunityNotificationUnreadSummaryDocument {
  communityId?: unknown;
  unreadCount?: unknown;
  priorityUnreadCount?: unknown;
  hasPriorityUnread?: unknown;
  updatedAt?: unknown;
}

export type CommunityNotificationSummaryReadState = 'loading' | 'ready' | 'error';

const GLOBAL_SUMMARY_VERSION = 2;
const MAX_ACTIVITY_COUNT = 1_000_000_000;
const EMPTY_GLOBAL_SUMMARY: CommunityNotificationGlobalSummary = Object.freeze({
  unreadCount: 0,
  priorityUnreadCount: 0,
  unreadCommunityCount: 0,
  priorityCommunityCount: 0,
  hasPriorityUnread: false,
  attentionWindow: [],
  updatedAt: null,
  ready: false,
});

@Injectable({ providedIn: 'root' })
export class CommunityNotificationUnreadSummaryService {
  private readonly firestore = inject(Firestore);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly readStateSubject =
    new BehaviorSubject<CommunityNotificationSummaryReadState>('loading');
  private readonly localSocialSuppressionSubject =
    new BehaviorSubject<ReadonlySet<string>>(new Set<string>());
  private readonly localSocialSuppressionCountsSubject =
    new BehaviorSubject<ReadonlyMap<string, number>>(new Map<string, number>());
  private latestGlobalSummary: CommunityNotificationGlobalSummary =
    EMPTY_GLOBAL_SUMMARY;
  private activeViewerUid: string | null | undefined = undefined;
  private readonly convergenceSubscriptions = new Set<string>();

  readonly readState$: Observable<CommunityNotificationSummaryReadState> =
    this.readStateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUserGlobalSummary$: Observable<CommunityNotificationGlobalSummary> =
    this.session.readyAuthUser$.pipe(
      switchMap((user) => {
        const uid = String(user?.uid ?? '').trim();
        this.handleViewerChange(uid || null);

        if (!uid) {
          this.readStateSubject.next('ready');
          this.latestGlobalSummary = {
            ...EMPTY_GLOBAL_SUMMARY,
            ready: true,
          };
          return of(this.latestGlobalSummary);
        }

        this.readStateSubject.next('loading');

        return this.watchUserGlobalSummary$(uid).pipe(
          tap((summary) => {
            this.latestGlobalSummary = summary;
            this.readStateSubject.next('ready');
          }),
          catchError((error: unknown) => {
            if (isFirebasePermissionDeniedError(error)) {
              this.readStateSubject.next('ready');
              const fallback = {
                ...EMPTY_GLOBAL_SUMMARY,
                ready: true,
              };
              this.latestGlobalSummary = fallback;
              return of(fallback);
            }

            this.readStateSubject.next('error');
            this.reportReadError(error, uid, 'watchUserGlobalSummary');
            return of({
              ...EMPTY_GLOBAL_SUMMARY,
              ready: true,
            });
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUserSummaries$: Observable<
    readonly CommunityNotificationUnreadSummary[]
  > = combineLatest([
    this.currentUserGlobalSummary$,
    this.localSocialSuppressionSubject,
  ]).pipe(
    map(([globalSummary, suppressedCommunityIds]) =>
      applyCommunitySocialUnreadSuppressions(
        globalSummary.attentionWindow,
        suppressedCommunityIds
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUserSummaryMap$: Observable<
    ReadonlyMap<string, CommunityNotificationUnreadSummary>
  > = this.currentUserSummaries$.pipe(
    map((summaries) => new Map(
      summaries.map((summary) => [summary.communityId, summary] as const)
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUserUnreadCount$: Observable<number> = combineLatest([
    this.currentUserGlobalSummary$,
    this.localSocialSuppressionCountsSubject,
  ]).pipe(
    map(([summary, suppressionCounts]) => {
      const locallySuppressed = [...suppressionCounts.values()].reduce(
        (total, count) => Math.min(MAX_ACTIVITY_COUNT, total + count),
        0
      );
      return Math.max(0, summary.unreadCount - locallySuppressed);
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUserPriorityCommunityCount$: Observable<number> =
    this.currentUserGlobalSummary$.pipe(
      map((summary) => summary.priorityCommunityCount),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  constructor() {
    this.session.readyUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) =>
        this.handleViewerChange(String(uid ?? '').trim() || null)
      );
  }

  suppressCommunitySocialUnreadAfterMembershipExit(
    communityIdValue: string
  ): void {
    const communityId = communityIdValue.trim();
    const uid = this.activeViewerUid ?? null;
    if (!communityId || !uid) return;

    const immediate = this.latestGlobalSummary.attentionWindow.find(
      (item) => item.communityId === communityId
    );
    if (immediate) {
      this.applyLocalSuppressionFromSummary(communityId, immediate);
    }

    this.watchSuppressionConvergence(uid, communityId);
  }

  private watchUserGlobalSummary$(
    uid: string
  ): Observable<CommunityNotificationGlobalSummary> {
    return this.firestoreContext.deferObservable$(() => {
      const summaryRef = doc(
        this.firestore,
        'community_notification_summaries',
        uid
      );

      return docData(summaryRef) as Observable<
        CommunityNotificationGlobalSummaryDocument | undefined
      >;
    }).pipe(
      map((document) => this.toGlobalSummary(document))
    );
  }

  private watchSuppressionConvergence(uid: string, communityId: string): void {
    const key = `${uid}:${communityId}`;
    if (this.convergenceSubscriptions.has(key)) return;
    this.convergenceSubscriptions.add(key);

    this.firestoreContext.deferObservable$(() => {
      const summaryRef = doc(
        this.firestore,
        'community_notification_summaries',
        uid,
        'items',
        communityId
      );

      return docData(summaryRef) as Observable<
        CommunityNotificationUnreadSummaryDocument | undefined
      >;
    }).pipe(
      map((document) => this.toSummary({
        ...(document ?? {}),
        communityId,
      })),
      tap((summary) => {
        if (summary) {
          this.applyLocalSuppressionFromSummary(communityId, summary);
        } else {
          this.clearLocalSuppression(communityId);
        }
      }),
      filter((summary) =>
        !summary || summary.unreadCount <= summary.priorityUnreadCount
      ),
      take(1),
      takeUntil(
        this.session.readyUid$.pipe(
          filter((activeUid) => String(activeUid ?? '').trim() !== uid)
        )
      ),
      catchError((error: unknown) => {
        this.reportReadError(
          error,
          uid,
          'watchMembershipExitSummaryConvergence'
        );
        this.clearLocalSuppression(communityId);
        return of(null);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      complete: () => this.convergenceSubscriptions.delete(key),
    });
  }

  private applyLocalSuppressionFromSummary(
    communityId: string,
    summary: CommunityNotificationUnreadSummary
  ): void {
    const socialUnreadCount = Math.max(
      0,
      summary.unreadCount - summary.priorityUnreadCount
    );

    if (socialUnreadCount <= 0) {
      this.clearLocalSuppression(communityId);
      return;
    }

    const ids = this.localSocialSuppressionSubject.value;
    if (!ids.has(communityId)) {
      this.localSocialSuppressionSubject.next(
        new Set([...ids, communityId])
      );
    }

    const counts = new Map(this.localSocialSuppressionCountsSubject.value);
    if (counts.get(communityId) !== socialUnreadCount) {
      counts.set(communityId, socialUnreadCount);
      this.localSocialSuppressionCountsSubject.next(counts);
    }
  }

  private clearLocalSuppression(communityId: string): void {
    const ids = this.localSocialSuppressionSubject.value;
    if (ids.has(communityId)) {
      const nextIds = new Set(ids);
      nextIds.delete(communityId);
      this.localSocialSuppressionSubject.next(nextIds);
    }

    const counts = this.localSocialSuppressionCountsSubject.value;
    if (counts.has(communityId)) {
      const nextCounts = new Map(counts);
      nextCounts.delete(communityId);
      this.localSocialSuppressionCountsSubject.next(nextCounts);
    }
  }

  private handleViewerChange(uid: string | null): void {
    if (this.activeViewerUid === uid) return;

    this.activeViewerUid = uid;
    this.latestGlobalSummary = EMPTY_GLOBAL_SUMMARY;
    this.convergenceSubscriptions.clear();

    if (this.localSocialSuppressionSubject.value.size > 0) {
      this.localSocialSuppressionSubject.next(new Set<string>());
    }
    if (this.localSocialSuppressionCountsSubject.value.size > 0) {
      this.localSocialSuppressionCountsSubject.next(new Map<string, number>());
    }
  }

  private toGlobalSummary(
    raw: CommunityNotificationGlobalSummaryDocument | undefined
  ): CommunityNotificationGlobalSummary {
    const projectionVersion = Math.trunc(Number(raw?.projectionVersion));
    const migrated =
      projectionVersion === GLOBAL_SUMMARY_VERSION
      && raw?.requiresBackfill !== true;

    if (!migrated) {
      return {
        ...EMPTY_GLOBAL_SUMMARY,
        ready: true,
      };
    }

    const unreadCount = this.toCount(raw?.unreadCount);
    const priorityUnreadCount = Math.min(
      unreadCount,
      this.toCount(raw?.priorityUnreadCount)
    );
    const attentionWindow = Array.isArray(raw?.attentionWindow)
      ? raw.attentionWindow
          .map((item) => this.toSummary(
            item as CommunityNotificationUnreadSummaryDocument
          ))
          .filter(
            (item): item is CommunityNotificationUnreadSummary => item !== null
          )
          .slice(0, 8)
      : [];

    return {
      unreadCount,
      priorityUnreadCount,
      unreadCommunityCount: this.toCount(raw?.unreadCommunityCount),
      priorityCommunityCount: this.toCount(raw?.priorityCommunityCount),
      hasPriorityUnread:
        priorityUnreadCount > 0 || raw?.hasPriorityUnread === true,
      attentionWindow,
      updatedAt: this.toMillis(raw?.updatedAt),
      ready: true,
    };
  }

  private toSummary(
    raw: CommunityNotificationUnreadSummaryDocument
  ): CommunityNotificationUnreadSummary | null {
    const communityId = String(raw.communityId ?? '').trim();
    const unreadCount = this.toCount(raw.unreadCount);

    if (!communityId || unreadCount <= 0) return null;

    const priorityUnreadCount = Math.min(
      unreadCount,
      this.toCount(raw.priorityUnreadCount)
    );

    return {
      communityId,
      unreadCount,
      priorityUnreadCount,
      hasPriorityUnread:
        priorityUnreadCount > 0 || raw.hasPriorityUnread === true,
      updatedAt: this.toMillis(raw.updatedAt),
    };
  }

  private toCount(value: unknown): number {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_ACTIVITY_COUNT)
      : 0;
  }

  private toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const timestamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
    } | null | undefined;

    if (typeof timestamp?.toMillis === 'function') {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }

    if (typeof timestamp?.toDate === 'function') {
      const millis = timestamp.toDate().getTime();
      return Number.isFinite(millis) ? millis : null;
    }

    return null;
  }

  private reportReadError(
    error: unknown,
    uid: string,
    operation: string
  ): void {
    this.applicationError.report(error, {
      feature: 'notifications.community-summary',
      operation,
      fallbackMessage:
        'Não foi possível carregar o resumo de notificações das Comunidades.',
      notification: 'none',
      metadata: {
        scope: 'CommunityNotificationUnreadSummaryService',
        uid,
      },
    });
  }
}
