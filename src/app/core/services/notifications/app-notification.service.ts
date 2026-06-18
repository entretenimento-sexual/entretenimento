// src/app/core/services/notifications/app-notification.service.ts
// -----------------------------------------------------------------------------
// APP NOTIFICATION SERVICE
// -----------------------------------------------------------------------------
// Leitura reativa das notificações internas do usuário autenticado.
//
// Decisões:
// - não grava no Firestore pelo cliente;
// - não marca como lida nesta fase porque as Rules bloqueiam update;
// - usa GlobalErrorHandlerService para debug centralizado;
// - falhas de leitura são silenciosas para não poluir a navegação.
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
import { Observable, of } from 'rxjs';
import {
  catchError,
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable({ providedIn: 'root' })
export class AppNotificationService {
  private readonly firestore = inject(Firestore);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly currentUserNotifications$: Observable<IAppNotification[]> =
    this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      distinctUntilChanged(),
      switchMap((uid) => this.watchForUser$(uid)),
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
    try {
      const err = error instanceof Error
        ? error
        : new Error('[AppNotificationService] read failed');

      (err as any).context = 'AppNotificationService';
      (err as any).operation = operation;
      (err as any).extra = extra;
      (err as any).skipUserNotification = true;
      (err as any).silent = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
