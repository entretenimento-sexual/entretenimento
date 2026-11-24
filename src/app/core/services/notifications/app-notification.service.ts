// src/app/core/services/notifications/app-notification.service.ts
// -----------------------------------------------------------------------------
// APP NOTIFICATION SERVICE
// -----------------------------------------------------------------------------
// Leitura reativa das notificações internas do usuário autenticado.
//
// Decisões:
// - leitura reativa via Firestore;
// - escrita de leitura passa por Cloud Functions;
// - cliente segue sem updateDoc direto em /notifications;
// - aguarda bootstrap do Auth antes de iniciar watchers de Firestore;
// - usa AuthSessionService.readyAuthUser$ como fonte única do usuário autenticado;
// - falhas opcionais de permissão na leitura retornam lista vazia sem poluir login;
// - falhas reais da leitura principal expõem estado recuperável para a Central;
// - retry manual substitui o listener atual, sem abrir listener paralelo;
// - resumos recentes por Comunidade derivam da janela global e servem só à apresentação;
// - o total exato de atividade não lida de Comunidades pertence à projeção agregada dedicada;
// - total global deriva da consulta reativa de documentos não lidos, sem janela;
// - custo dessa transição precisa ser medido antes da produção.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { onSnapshot } from 'firebase/firestore';
import { recoverDirectChatListener$ } from 'src/app/messaging/direct-chat/services/direct-chat-listener-recovery';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  defer,
  from,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';

import {
  AppNotificationType,
  IAppNotification,
  IAppNotificationListVm,
  ICommunityNotificationSummary,
} from 'src/app/core/interfaces/app-notification.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { buildCommunityNotificationSummaries } from 'src/app/core/services/notifications/community-notification-summary.policy';
import {
  isFirebasePermissionDeniedError,
} from 'src/app/core/utils/firebase-error-utils';

interface AppNotificationFirestoreDocument {
  id?: unknown;
  userId?: unknown;
  type?: unknown;
  title?: unknown;
  body?: unknown;
  route?: unknown;
  caseId?: unknown;
  legalVersion?: unknown;
  actionRequired?: unknown;
  responseDueAt?: unknown;
  policySection?: unknown;
  communityId?: unknown;
  postId?: unknown;
  commentId?: unknown;
  replyToCommentId?: unknown;
  replyId?: unknown;
  actorUid?: unknown;
  inviteId?: unknown;
  roomId?: unknown;
  messageId?: unknown;
  activityCount?: unknown;
  mediaType?: unknown;
  mediaId?: unknown;
  moderationTarget?: unknown;
  readAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface MarkNotificationReadPayload {
  notificationId: string;
}

interface MarkAllNotificationsReadResponse {
  updated: number;
  complete?: boolean;
}

export interface MarkAllNotificationsReadResult {
  updated: number;
  complete: boolean;
}

export type NotificationReadState = 'loading' | 'ready' | 'error';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const LEGACY_MARK_ALL_BATCH_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class AppNotificationService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly currentUserRefreshSubject = new BehaviorSubject(0);
  private readonly currentUserReadStateSubject =
    new BehaviorSubject<NotificationReadState>('loading');

  private readonly markNotificationReadCallable = httpsCallable<
    MarkNotificationReadPayload,
    { ok: true }
  >(this.functions, 'markNotificationRead');

  private readonly markAllNotificationsReadCallable = httpsCallable<
    Record<string, never>,
    MarkAllNotificationsReadResponse
  >(this.functions, 'markAllNotificationsRead');

  readonly currentUserReadState$: Observable<NotificationReadState> =
    this.currentUserReadStateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUserNotifications$: Observable<IAppNotification[]> =
    combineLatest([
      this.session.readyAuthUser$.pipe(map(user => String(user?.uid ?? '').trim()), distinctUntilChanged()),
      this.currentUserRefreshSubject,
    ]).pipe(
      switchMap(([uid]) => {

        if (!uid) {
          this.currentUserReadStateSubject.next('ready');
          return of([]);
        }

        this.currentUserReadStateSubject.next('loading');

        return recoverDirectChatListener$(
          () => this.watchForUserQuery$(uid, DEFAULT_LIMIT).pipe(
            tap(() => this.currentUserReadStateSubject.next('ready'))
          ),
          error => {
            this.currentUserReadStateSubject.next('error');
            this.reportReadError(error, 'currentUserNotifications', { uid });
            return [] as IAppNotification[];
          }
        ).pipe(
          catchError((error) => {
            if (isFirebasePermissionDeniedError(error)) {
              this.currentUserReadStateSubject.next('ready');
              return of([]);
            }

            this.currentUserReadStateSubject.next('error');
            this.reportReadError(error, 'currentUserNotifications', { uid });
            return of([]);
          }),
          startWith([] as IAppNotification[])
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  // Single shared exact read path, independent of the recent 20-item window.
  readonly currentUserUnreadCount$: Observable<number> = this.session.readyAuthUser$.pipe(
    map(user => String(user?.uid ?? '').trim()),
    distinctUntilChanged(),
    switchMap(uid => uid
      ? recoverDirectChatListener$(
          () => this.countUnreadForUser$(uid),
          error => { this.reportReadError(error, 'countUnreadForUser', { uid }); return 0; }
        ).pipe(
          startWith(0),
          catchError(error => {
            this.reportReadError(error, 'countUnreadForUser', { uid });
            return of(0);
          })
        )
      : of(0)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Agrupamentos da janela recente carregada pela Central.
   *
   * Esta projeção é adequada para cards/resumos recentes, mas é deliberadamente
   * incompleta para totais. Totais de atividade não lida por Comunidade devem
   * vir de CommunityNotificationUnreadSummaryService.currentUserUnreadCount$.
   */
  readonly currentUserCommunitySummaries$: Observable<
    ICommunityNotificationSummary[]
  > = this.currentUserNotifications$.pipe(
    map((items) => buildCommunityNotificationSummaries(items)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUserVm$: Observable<IAppNotificationListVm> = combineLatest([
    this.currentUserNotifications$,
    this.currentUserUnreadCount$,
  ]).pipe(
    map(([items, unreadCount]) => ({
      loading: false,
      items,
      unreadCount,
    })),
    startWith({ loading: true, items: [], unreadCount: 0 }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  refreshCurrentUserNotifications(): void {
    this.currentUserReadStateSubject.next('loading');
    this.currentUserRefreshSubject.next(
      this.currentUserRefreshSubject.value + 1
    );
  }

  watchForUser$(uid: string, max = DEFAULT_LIMIT): Observable<IAppNotification[]> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of([]);
    }

    return this.watchForUserQuery$(safeUid, max).pipe(
      catchError((error) => {
        this.reportReadError(error, 'watchForUser', { uid: safeUid });
        return of([]);
      })
    );
  }

  markAsRead$(notificationId: string): Observable<void> {
    const safeNotificationId = String(notificationId ?? '').trim();

    if (!safeNotificationId) {
      return throwError(() => new Error('Notificação inválida.'));
    }

    return defer(() => from(this.markNotificationReadCallable({
      notificationId: safeNotificationId,
    }))).pipe(
      map(() => undefined),
      catchError((error) => throwError(() => error))
    );
  }

  markAllAsRead$(): Observable<MarkAllNotificationsReadResult> {
    return defer(() => from(this.markAllNotificationsReadCallable({}))).pipe(
      map((response) => {
        const parsedUpdated = Math.trunc(Number(response.data?.updated ?? 0));
        const updated = Number.isFinite(parsedUpdated)
          ? Math.max(0, parsedUpdated)
          : 0;
        const explicitComplete = response.data?.complete;
        const complete = typeof explicitComplete === 'boolean'
          ? explicitComplete
          : updated < LEGACY_MARK_ALL_BATCH_SIZE;

        return { updated, complete };
      }),
      catchError((error) => throwError(() => error))
    );
  }

  private watchForUserQuery$(
    uid: string,
    max = DEFAULT_LIMIT
  ): Observable<IAppNotification[]> {
    const safeLimit = this.normalizeLimit(max);

    return this.firestoreContext.deferObservable$(() => {
      const notificationsRef = collection(this.firestore, 'notifications');
      const notificationsQuery = query(
        notificationsRef,
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        firestoreLimit(safeLimit)
      );

      return new Observable<AppNotificationFirestoreDocument[]>(sink => onSnapshot(
        notificationsQuery, { includeMetadataChanges: true }, snapshot => {
          sink.next(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites ? [] :
            snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        }, error => sink.error(error)
      ));
    }).pipe(
      map((items) =>
        (items ?? [])
          .map((item) => this.toNotification(item))
          .filter((item): item is IAppNotification => !!item)
      )
    );
  }

  private countUnreadForUser$(uid: string): Observable<number> {
    return this.firestoreContext.deferObservable$(() => {
      const unreadQuery = query(collection(this.firestore, 'notifications'),
        where('userId', '==', uid), where('readAt', '==', null));
      return new Observable<number>(sink => onSnapshot(
        unreadQuery, { includeMetadataChanges: true }, snapshot => {
          sink.next(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites ? 0 : snapshot.size);
        }, error => sink.error(error)
      ));
    });
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value ?? DEFAULT_LIMIT);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  private toNotification(
    raw: AppNotificationFirestoreDocument
  ): IAppNotification | null {
    const id = this.toText(raw.id);
    const userId = this.toText(raw.userId);
    const title = this.toText(raw.title);
    const body = this.toText(raw.body);

    if (!id || !userId || !title || !body) {
      return null;
    }

    return {
      id,
      userId,
      type: this.toType(raw.type),
      title,
      body,
      route: this.toText(raw.route) || null,
      caseId: this.toText(raw.caseId) || null,
      legalVersion: this.toText(raw.legalVersion) || null,
      actionRequired:
        typeof raw.actionRequired === 'boolean'
          ? raw.actionRequired
          : null,
      responseDueAt: this.toMillis(raw.responseDueAt),
      policySection: this.toText(raw.policySection) || null,
      communityId: this.toText(raw.communityId) || null,
      postId: this.toText(raw.postId) || null,
      commentId: this.toText(raw.commentId) || null,
      replyToCommentId: this.toText(raw.replyToCommentId) || null,
      replyId: this.toText(raw.replyId) || null,
      actorUid: this.toText(raw.actorUid) || null,
      inviteId: this.toText(raw.inviteId) || null,
      roomId: this.toText(raw.roomId) || null,
      messageId: this.toText(raw.messageId) || null,
      activityCount: this.toPositiveInteger(raw.activityCount),
      mediaType:
        raw.mediaType === 'photo' || raw.mediaType === 'video'
          ? raw.mediaType
          : null,
      mediaId: this.toText(raw.mediaId) || null,
      moderationTarget:
        raw.moderationTarget === 'comment'
        || raw.moderationTarget === 'reply'
        || raw.moderationTarget === 'post'
          ? raw.moderationTarget
          : null,
      readAt: this.toMillis(raw.readAt),
      createdAt: this.toMillis(raw.createdAt),
      updatedAt: this.toMillis(raw.updatedAt),
    };
  }

  private toType(value: unknown): AppNotificationType {
    const raw = this.toText(value);

    switch (raw) {
      case 'user_intent_status.published':
      case 'user_intent_status.compatible':
      case 'compliance.terms.update_required':
      case 'compliance.terms.updated':
      case 'compliance.violation.suspected':
      case 'compliance.violation.response_received':
      case 'compliance.violation.resolved':
      case 'compliance.action.taken':
      case 'community.comment.received':
      case 'community.comment.reply.received':
      case 'community.post.reply.received':
      case 'community.post.reaction.received':
      case 'community.membership.approved':
      case 'community.membership.rejected':
      case 'community.membership.requested':
      case 'community.membership.removed':
      case 'community.membership.blocked':
      case 'community.membership.unblocked':
      case 'community.invite.accepted':
      case 'community.invite.declined':
      case 'community.content.moderated':
      case 'media.photo.published':
      case 'media.video.published':
      case 'system':
      case 'social':
      case 'chat':
      case 'billing':
        return raw;
      default:
        return 'system';
    }
  }

  private toText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private toPositiveInteger(value: unknown): number | null {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const maybeTimestamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
    } | null | undefined;

    if (typeof maybeTimestamp?.toMillis === 'function') {
      const millis = maybeTimestamp.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }

    if (typeof maybeTimestamp?.toDate === 'function') {
      const millis = maybeTimestamp.toDate().getTime();
      return Number.isFinite(millis) ? millis : null;
    }

    return null;
  }

  private reportReadError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    if (isFirebasePermissionDeniedError(error)) {
      return;
    }

    this.applicationError.report(error, {
      feature: 'notifications',
      operation,
      fallbackMessage: 'Não foi possível carregar as notificações.',
      notification: 'none',
      metadata: {
        scope: 'AppNotificationService',
        ...extra,
      },
    });
  }
}
