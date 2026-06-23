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
// - falhas opcionais de permissão na leitura retornam lista vazia sem poluir login.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, of, throwError } from 'rxjs';
import {
  catchError,
  combineLatestWith,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import {
  IAppNotification,
  IAppNotificationListVm,
  AppNotificationType,
} from 'src/app/core/interfaces/app-notification.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface AppNotificationFirestoreDocument {
  id?: unknown;
  userId?: unknown;
  type?: unknown;
  title?: unknown;
  body?: unknown;
  route?: unknown;
  readAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface MarkNotificationReadPayload {
  notificationId: string;
}

interface MarkAllNotificationsReadResponse {
  updated: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable({ providedIn: 'root' })
export class AppNotificationService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly markNotificationReadCallable = httpsCallable<
    MarkNotificationReadPayload,
    { ok: true }
  >(this.functions, 'markNotificationRead');

  private readonly markAllNotificationsReadCallable = httpsCallable<
    Record<string, never>,
    MarkAllNotificationsReadResponse
  >(this.functions, 'markAllNotificationsRead');

  readonly currentUserNotifications$: Observable<IAppNotification[]> =
    this.session.ready$.pipe(
      combineLatestWith(this.session.authUser$),
      switchMap(([ready, user]) => {
        const uid = String(user?.uid ?? '').trim();

        if (ready !== true || !uid) {
          return of([]);
        }

        return defer(() => from(user!.getIdToken())).pipe(
          switchMap(() => this.watchForUser$(uid)),
          catchError((error) => {
            this.reportReadError(error, 'currentUserNotifications', { uid });
            return of([]);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUserUnreadCount$: Observable<number> =
    this.currentUserNotifications$.pipe(
      map((items) => items.filter((item) => item.readAt == null).length),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUserVm$: Observable<IAppNotificationListVm> =
    this.currentUserNotifications$.pipe(
      map((items) => ({
        loading: false,
        items,
        unreadCount: items.filter((item) => item.readAt == null).length,
      })),
      startWith({ loading: true, items: [], unreadCount: 0 }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  watchForUser$(uid: string, max = DEFAULT_LIMIT): Observable<IAppNotification[]> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of([]);
    }

    const safeLimit = this.normalizeLimit(max);

    return this.firestoreContext.deferObservable$(() => {
      const notificationsRef = collection(this.firestore, 'notifications');
      const notificationsQuery = query(
        notificationsRef,
        where('userId', '==', safeUid),
        orderBy('createdAt', 'desc'),
        firestoreLimit(safeLimit)
      );

      return collectionData(notificationsQuery, { idField: 'id' }) as Observable<
        AppNotificationFirestoreDocument[]
      >;
    }).pipe(
      map((items) =>
        (items ?? [])
          .map((item) => this.toNotification(item))
          .filter((item): item is IAppNotification => !!item)
      ),
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
      catchError((error) => {
        this.reportWriteError(error, 'markAsRead', { notificationId: safeNotificationId });
        return throwError(() => error);
      })
    );
  }

  markAllAsRead$(): Observable<number> {
    return defer(() => from(this.markAllNotificationsReadCallable({}))).pipe(
      map((response) => Number(response.data?.updated ?? 0)),
      catchError((error) => {
        this.reportWriteError(error, 'markAllAsRead', {});
        return throwError(() => error);
      })
    );
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
    if (this.isPermissionDenied(error)) {
      return;
    }

    try {
      const err = error instanceof Error
        ? error
        : new Error('[AppNotificationService] read failed');
      (err as any).context = 'AppNotificationService';
      (err as any).operation = operation;
      (err as any).extra = extra;
      (err as any).original = error;
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }

  private reportWriteError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    try {
      const err = error instanceof Error
        ? error
        : new Error('[AppNotificationService] write failed');
      (err as any).context = 'AppNotificationService';
      (err as any).operation = operation;
      (err as any).extra = extra;
      (err as any).original = error;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }

  private isPermissionDenied(error: unknown): boolean {
    const source = error as { code?: unknown; message?: unknown } | null | undefined;
    const code = String(source?.code ?? '').toLowerCase();
    const message = String(source?.message ?? '').toLowerCase();

    return code.includes('permission-denied')
      || message.includes('permission')
      || message.includes('no matching allow statements');
  }
}
