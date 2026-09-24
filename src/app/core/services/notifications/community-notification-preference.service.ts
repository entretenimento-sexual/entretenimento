// src/app/core/services/notifications/community-notification-preference.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION PREFERENCE SERVICE
// -----------------------------------------------------------------------------
// Um único listener por usuário para preferências privadas por Comunidade.
// Os documentos são esparsos: somente Comunidades silenciadas existem.
// A escrita nunca vai direto ao Firestore; passa pela callable canônica, que
// revalida autenticação, App Check e membership ativo no backend.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  BehaviorSubject,
  Observable,
  defer,
  from,
  map,
  of,
  shareReplay,
  switchMap,
  catchError,
  distinctUntilChanged,
  tap,
  throwError,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  isFirebasePermissionDeniedError,
} from 'src/app/core/utils/firebase-error-utils';

interface CommunityNotificationPreferenceDocument {
  id?: unknown;
  communityId?: unknown;
  muted?: unknown;
}

interface UpdateCommunityNotificationPreferenceCommand {
  readonly communityId: string;
  readonly muted: boolean;
}

export interface CommunityNotificationPreferenceUpdateResult {
  readonly communityId: string;
  readonly muted: boolean;
}

export type CommunityNotificationPreferenceReadState =
  | 'loading'
  | 'ready'
  | 'error';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

@Injectable({ providedIn: 'root' })
export class CommunityNotificationPreferenceService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly readStateSubject =
    new BehaviorSubject<CommunityNotificationPreferenceReadState>('loading');

  private readonly updatePreferenceCallable = httpsCallable<
    UpdateCommunityNotificationPreferenceCommand,
    unknown
  >(this.functions, 'updateCommunityNotificationPreference');

  readonly readState$: Observable<CommunityNotificationPreferenceReadState> =
    this.readStateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUserMutedCommunityIds$: Observable<ReadonlySet<string>> =
    this.session.readyAuthUser$.pipe(
      switchMap((user) => {
        const uid = String(user?.uid ?? '').trim();

        if (!uid) {
          this.readStateSubject.next('ready');
          return of<ReadonlySet<string>>(new Set<string>());
        }

        this.readStateSubject.next('loading');

        return this.watchMutedCommunityIds$(uid).pipe(
          tap(() => this.readStateSubject.next('ready')),
          catchError((error: unknown) => {
            if (isFirebasePermissionDeniedError(error)) {
              this.readStateSubject.next('ready');
              return of<ReadonlySet<string>>(new Set<string>());
            }

            this.readStateSubject.next('error');
            this.reportError(error, 'watchMutedCommunityIds', { uid });
            return of<ReadonlySet<string>>(new Set<string>());
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  updateMuted$(
    communityId: string,
    muted: boolean
  ): Observable<CommunityNotificationPreferenceUpdateResult> {
    const safeCommunityId = String(communityId ?? '').trim();

    if (!SAFE_ID_PATTERN.test(safeCommunityId)) {
      return throwError(() => new Error('Comunidade inválida para preferência de notificação.'));
    }

    return defer(() =>
      from(this.updatePreferenceCallable({
        communityId: safeCommunityId,
        muted,
      }))
    ).pipe(
      map((callableResult) => {
        const raw = callableResult.data as Partial<
          CommunityNotificationPreferenceUpdateResult
        > | null | undefined;
        const resultCommunityId = String(raw?.communityId ?? '').trim();

        if (
          resultCommunityId !== safeCommunityId
          || typeof raw?.muted !== 'boolean'
        ) {
          throw new Error('Resposta de preferência de notificação inválida.');
        }

        return {
          communityId: resultCommunityId,
          muted: raw.muted,
        };
      }),
      catchError((error: unknown) => throwError(() => error))
    );
  }

  private watchMutedCommunityIds$(uid: string): Observable<ReadonlySet<string>> {
    return this.firestoreContext.deferObservable$(() => {
      const preferencesRef = collection(
        this.firestore,
        'community_notification_preferences',
        uid,
        'items'
      );

      return collectionData(preferencesRef, { idField: 'id' }) as Observable<
        CommunityNotificationPreferenceDocument[]
      >;
    }).pipe(
      map((documents) => {
        const mutedIds = new Set<string>();

        for (const document of documents ?? []) {
          if (document.muted !== true) continue;

          const communityId = String(
            document.communityId ?? document.id ?? ''
          ).trim();

          if (SAFE_ID_PATTERN.test(communityId)) {
            mutedIds.add(communityId);
          }
        }

        return mutedIds as ReadonlySet<string>;
      })
    );
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    this.applicationError.report(error, {
      feature: 'notifications.community-preference',
      operation,
      fallbackMessage: 'Não foi possível carregar as preferências de notificações da Comunidade.',
      notification: 'none',
      metadata: {
        scope: 'CommunityNotificationPreferenceService',
        ...extra,
      },
    });
  }
}
