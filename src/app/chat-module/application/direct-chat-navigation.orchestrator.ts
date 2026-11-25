import { Injectable } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { EMPTY, Observable, combineLatest, defer, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
} from 'rxjs/operators';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';

export interface DirectChatDeepLinkPayload {
  openChatId?: string;
  withUser?: string;
}

export interface ResolvedDirectChatDeepLink {
  chatId: string;
  withUser?: string;
}

export interface DirectChatPeerContext {
  uid: string;
  name: string | null;
  photoURL: string | null;
}

@Injectable()
export class DirectChatNavigationOrchestrator {
  constructor(
    private readonly directChatService: DirectChatService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly router: Router
  ) {}

  observeResolvedDeepLinks$(
    currentUid$: Observable<string | null>,
    queryParamMap$: Observable<ParamMap>,
    onError?: (error: unknown) => void
  ): Observable<ResolvedDirectChatDeepLink | null> {
    const queryDeepLink$ = queryParamMap$.pipe(
      map((query): DirectChatDeepLinkPayload => ({
        openChatId: (query.get('openChatId') ?? '').trim() || undefined,
        withUser: (query.get('withUser') ?? '').trim() || undefined,
      })),
      distinctUntilChanged(
        (a, b) => a.openChatId === b.openChatId && a.withUser === b.withUser
      )
    );

    // State belongs to this subscription, not to the injectable instance.
    // A pending URL is a one-shot intent of the session that received it.
    return defer(() => {
      let previous: DirectChatDeepLinkPayload | null = null;
      return combineLatest([
        currentUid$.pipe(map(uid => uid?.trim() || null), distinctUntilChanged()),
        queryDeepLink$,
      ]).pipe(
        switchMap(([uid, payload]) => {
          const repeatedPayload = previous === payload;
          previous = payload;
          if (!payload.openChatId && !payload.withUser) return EMPTY;

          // Same payload after an owner transition: cancel the old resolution
          // and consume the URL, never resolve it under the replacement owner.
          if (repeatedPayload || !uid) return of(null);

          return defer(() => this.resolveDeepLink$(uid, payload)).pipe(
            catchError(error => {
              onError?.(error);
              return of(null);
            })
          );
        })
      );
    });
  }

  consumeDeepLinkQueryParams(route: ActivatedRoute): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: route,
      queryParams: {
        openChatId: null,
        withUser: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  resolvePeer$(peerUid: string): Observable<DirectChatPeerContext | null> {
    const safePeerUid = (peerUid ?? '').trim();

    if (!safePeerUid) {
      return of(null);
    }

    return this.firestoreUserQuery.getPublicUserById$(safePeerUid).pipe(
      map((user) => ({
        uid: safePeerUid,
        name: user?.nickname?.trim() || null,
        photoURL: user?.photoURL?.trim() || null,
      }))
    );
  }

  private resolveDeepLink$(
    uid: string | null,
    payload: DirectChatDeepLinkPayload
  ): Observable<ResolvedDirectChatDeepLink | null> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid || (!payload.openChatId && !payload.withUser)) {
      return of(null);
    }

    if (payload.openChatId) {
      return of({
        chatId: payload.openChatId,
        withUser: payload.withUser,
      });
    }

    if (!payload.withUser) {
      return of(null);
    }

    if (payload.withUser === safeUid) {
      return throwError(
        () => new Error('withUser inválido para chat direto.')
      );
    }

    return this.directChatService.ensureDirectChatIdWithUser$(payload.withUser).pipe(
      map((chatId) =>
        chatId
          ? {
              chatId,
              withUser: payload.withUser,
            }
          : null
      )
    );
  }
}
