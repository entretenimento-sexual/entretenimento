// src/app/core/services/notifications/community-notification-unread-summary.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION UNREAD SUMMARY SERVICE
// -----------------------------------------------------------------------------
// Um único listener por usuário para a projeção privada de unread por Comunidade.
// A quantidade de Comunidades não cria listeners adicionais. Membership, role,
// nome e identidade visual continuam fora desta projeção.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Firestore,
  collection,
  collectionData,
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
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  isFirebasePermissionDeniedError,
  toErrorInstance,
} from 'src/app/core/utils/firebase-error-utils';
import {
  applyCommunitySocialUnreadSuppressions,
  reconcileCommunitySocialUnreadSuppressions,
  shouldSuppressCommunitySocialUnreadLocally,
} from './community-notification-unread-summary.local';

export interface CommunityNotificationUnreadSummary {
  readonly communityId: string;
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly hasPriorityUnread: boolean;
  readonly updatedAt: number | null;
}

interface CommunityNotificationUnreadSummaryDocument {
  id?: unknown;
  communityId?: unknown;
  unreadCount?: unknown;
  priorityUnreadCount?: unknown;
  hasPriorityUnread?: unknown;
  updatedAt?: unknown;
}

interface CommunityNotificationSummaryReportableError extends Error {
  context?: string;
  operation?: string;
  extra?: Record<string, unknown>;
  original?: unknown;
  skipUserNotification?: boolean;
}

export type CommunityNotificationSummaryReadState = 'loading' | 'ready' | 'error';

const MAX_ACTIVITY_COUNT = 1_000_000_000;

@Injectable({ providedIn: 'root' })
export class CommunityNotificationUnreadSummaryService {
  private readonly firestore = inject(Firestore);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly readStateSubject =
    new BehaviorSubject<CommunityNotificationSummaryReadState>('loading');
  private readonly localSocialSuppressionSubject =
    new BehaviorSubject<ReadonlySet<string>>(new Set<string>());
  private latestCanonicalSummaries: readonly CommunityNotificationUnreadSummary[] = [];
  private canonicalSummariesReady = false;
  private activeViewerUid: string | null | undefined = undefined;

  readonly readState$: Observable<CommunityNotificationSummaryReadState> =
    this.readStateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly currentUserCanonicalSummaries$: Observable<
    readonly CommunityNotificationUnreadSummary[]
  > = this.session.readyAuthUser$.pipe(
    switchMap((user) => {
      const uid = String(user?.uid ?? '').trim();
      this.handleViewerChange(uid || null);

      if (!uid) {
        this.readStateSubject.next('ready');
        this.handleCanonicalSummaries([]);
        return of<readonly CommunityNotificationUnreadSummary[]>([]);
      }

      this.readStateSubject.next('loading');

      return this.watchUserSummaries$(uid).pipe(
        tap((summaries) => {
          this.handleCanonicalSummaries(summaries);
          this.readStateSubject.next('ready');
        }),
        catchError((error: unknown) => {
          if (isFirebasePermissionDeniedError(error)) {
            this.readStateSubject.next('ready');
            this.handleCanonicalSummaries([]);
            return of<readonly CommunityNotificationUnreadSummary[]>([]);
          }

          this.readStateSubject.next('error');
          this.reportReadError(error, uid);
          return of<readonly CommunityNotificationUnreadSummary[]>([]);
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUserSummaries$: Observable<
    readonly CommunityNotificationUnreadSummary[]
  > = combineLatest([
    this.currentUserCanonicalSummaries$,
    this.localSocialSuppressionSubject,
  ]).pipe(
    map(([summaries, suppressedCommunityIds]) =>
      applyCommunitySocialUnreadSuppressions(
        summaries,
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

  readonly currentUserUnreadCount$: Observable<number> =
    this.currentUserSummaries$.pipe(
      map((summaries) => summaries.reduce(
        (total, summary) => Math.min(
          MAX_ACTIVITY_COUNT,
          total + summary.unreadCount
        ),
        0
      )),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  constructor() {
    this.session.readyUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => this.handleViewerChange(String(uid ?? '').trim() || null));
  }

  suppressCommunitySocialUnreadAfterMembershipExit(communityIdValue: string): void {
    const communityId = communityIdValue.trim();
    if (!communityId) return;

    if (
      this.canonicalSummariesReady
      && !shouldSuppressCommunitySocialUnreadLocally(
        this.latestCanonicalSummaries,
        communityId
      )
    ) {
      return;
    }

    const current = this.localSocialSuppressionSubject.value;
    if (current.has(communityId)) return;

    this.localSocialSuppressionSubject.next(
      new Set([...current, communityId])
    );
  }

  private watchUserSummaries$(
    uid: string
  ): Observable<readonly CommunityNotificationUnreadSummary[]> {
    return this.firestoreContext.deferObservable$(() => {
      const summariesRef = collection(
        this.firestore,
        'community_notification_summaries',
        uid,
        'items'
      );

      return collectionData(summariesRef, { idField: 'id' }) as Observable<
        CommunityNotificationUnreadSummaryDocument[]
      >;
    }).pipe(
      map((documents) =>
        (documents ?? [])
          .map((document) => this.toSummary(document))
          .filter(
            (summary): summary is CommunityNotificationUnreadSummary =>
              summary !== null
          )
      )
    );
  }

  private handleViewerChange(uid: string | null): void {
    if (this.activeViewerUid === uid) return;

    this.activeViewerUid = uid;
    this.latestCanonicalSummaries = [];
    this.canonicalSummariesReady = false;
    if (this.localSocialSuppressionSubject.value.size > 0) {
      this.localSocialSuppressionSubject.next(new Set<string>());
    }
  }

  private handleCanonicalSummaries(
    summaries: readonly CommunityNotificationUnreadSummary[]
  ): void {
    this.latestCanonicalSummaries = summaries;
    this.canonicalSummariesReady = true;

    const current = this.localSocialSuppressionSubject.value;
    const reconciled = reconcileCommunitySocialUnreadSuppressions(
      summaries,
      current
    );
    if (this.sameIds(current, reconciled)) return;

    this.localSocialSuppressionSubject.next(reconciled);
  }

  private sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    if (left.size !== right.size) return false;
    for (const id of left) {
      if (!right.has(id)) return false;
    }
    return true;
  }

  private toSummary(
    raw: CommunityNotificationUnreadSummaryDocument
  ): CommunityNotificationUnreadSummary | null {
    const communityId = String(raw.communityId ?? raw.id ?? '').trim();
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

  private reportReadError(error: unknown, uid: string): void {
    try {
      const reportable = toErrorInstance(
        error,
        '[CommunityNotificationUnreadSummaryService] read failed'
      ) as CommunityNotificationSummaryReportableError;
      reportable.context = 'CommunityNotificationUnreadSummaryService';
      reportable.operation = 'watchUserSummaries';
      reportable.extra = { uid };
      reportable.original = error;
      reportable.skipUserNotification = true;
      this.globalError.handleError(reportable);
    } catch {
      // noop
    }
  }
}
