// src/app/core/services/notifications/notification-preferences.service.ts
// -----------------------------------------------------------------------------
// NOTIFICATION PREFERENCES SERVICE
// -----------------------------------------------------------------------------
// Lê e grava preferências privadas de notificação do usuário autenticado.
//
// Segurança:
// - cada usuário só acessa preferences/{uid} pelas Rules atuais;
// - grava apenas um submapa conhecido: notificationPreferences;
// - conta/segurança permanece sempre ativo na normalização;
// - erros técnicos seguem para GlobalErrorHandlerService.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  docData,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  INotificationPreferences,
  INotificationPreferencesVm,
  NotificationPreferenceEditableKey,
} from 'src/app/core/interfaces/notification-preferences.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface UserPreferencesDocument {
  notificationPreferences?: unknown;
}

@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly firestore = inject(Firestore);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly currentPreferences$: Observable<INotificationPreferences> =
    this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      distinctUntilChanged(),
      switchMap((uid) => this.watchForUser$(uid)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentVm$: Observable<INotificationPreferencesVm> =
    this.currentPreferences$.pipe(
      map((preferences) => ({ loading: false, preferences })),
      startWith({
        loading: true,
        preferences: DEFAULT_NOTIFICATION_PREFERENCES,
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  watchForUser$(uid: string): Observable<INotificationPreferences> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of(DEFAULT_NOTIFICATION_PREFERENCES);
    }

    return this.firestoreContext.deferObservable$(() => {
      const preferencesRef = doc(this.firestore, 'preferences', safeUid);
      return docData(preferencesRef) as Observable<UserPreferencesDocument | undefined>;
    }).pipe(
      map((document) => this.normalizePreferences(document?.notificationPreferences)),
      catchError((error) => {
        this.reportError(error, 'watchForUser', { uid: safeUid });
        return of(DEFAULT_NOTIFICATION_PREFERENCES);
      })
    );
  }

  updateCurrentPreferences$(
    patch: Partial<Record<NotificationPreferenceEditableKey, boolean>>
  ): Observable<void> {
    const normalizedPatch = this.normalizePatch(patch);

    if (Object.keys(normalizedPatch).length === 0) {
      return of(undefined);
    }

    return this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      switchMap((uid) => {
        if (!uid) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        return this.firestoreContext.deferPromise$(() => {
          const preferencesRef = doc(this.firestore, 'preferences', uid);
          return setDoc(
            preferencesRef,
            {
              notificationPreferences: normalizedPatch,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }).pipe(map(() => undefined));
      }),
      catchError((error) => {
        this.reportError(error, 'updateCurrentPreferences', { patch: normalizedPatch });
        return throwError(() => error);
      })
    );
  }

  private normalizePatch(
    patch: Partial<Record<NotificationPreferenceEditableKey, boolean>>
  ): Partial<Record<NotificationPreferenceEditableKey, boolean>> {
    const next: Partial<Record<NotificationPreferenceEditableKey, boolean>> = {};
    const keys: NotificationPreferenceEditableKey[] = [
      'messages',
      'connections',
      'rooms',
      'places',
      'compatibleStatus',
    ];

    keys.forEach((key) => {
      if (typeof patch[key] === 'boolean') {
        next[key] = patch[key];
      }
    });

    return next;
  }

  private normalizePreferences(raw: unknown): INotificationPreferences {
    const source = raw as Partial<INotificationPreferences> | null | undefined;

    return {
      messages: this.toBool(source?.messages, DEFAULT_NOTIFICATION_PREFERENCES.messages),
      connections: this.toBool(source?.connections, DEFAULT_NOTIFICATION_PREFERENCES.connections),
      rooms: this.toBool(source?.rooms, DEFAULT_NOTIFICATION_PREFERENCES.rooms),
      places: this.toBool(source?.places, DEFAULT_NOTIFICATION_PREFERENCES.places),
      compatibleStatus: this.toBool(
        source?.compatibleStatus,
        DEFAULT_NOTIFICATION_PREFERENCES.compatibleStatus
      ),
      accountSecurity: true,
    };
  }

  private toBool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    try {
      const err = error instanceof Error
        ? error
        : new Error('[NotificationPreferencesService] operation failed');

      (err as any).context = 'NotificationPreferencesService';
      (err as any).operation = operation;
      (err as any).extra = extra;
      (err as any).original = error;
      (err as any).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
