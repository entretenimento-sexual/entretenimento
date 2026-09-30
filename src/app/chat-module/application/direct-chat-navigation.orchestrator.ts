import { Injectable } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
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
  private appliedDeepLinkKey: string | null = null;

  constructor(
    private readonly directChatService: DirectChatService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly router: Router
  ) {}

  observeResolvedDeepLinks$(
    currentUid$: Observable<string | null>,
    queryParamMap$: Observable<ParamMap>
  ): Observable<ResolvedDirectChatDeepLink | null> {
    const queryDeepLink$ = queryParamMap$.pipe(
      map((query): DirectChatDeepLinkPayload => ({
        openChatId: (query.get('openChatId') ?? '').trim() || undefined,
        withUser: (query.get('withUser') ?? '').trim() || undefined,
      })),
      distinctUntilChanged(
        (a, b) =>
          a.openChatId === b.openChatId &&
          a.withUser === b.withUser
      ),
      tap((payload) => {
        if (!payload.openChatId && !payload.withUser) {
          this.appliedDeepLinkKey = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return currentUid$.pipe(
      switchMap((uid) =>
        queryDeepLink$.pipe(
          switchMap((payload) => this.resolveDeepLink$(uid, payload))
        )
      )
    );
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

    const key = `${safeUid}:${payload.openChatId ?? ''}:${payload.withUser ?? ''}`;

    if (this.appliedDeepLinkKey === key) {
      return of(null);
    }

    this.appliedDeepLinkKey = key;

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
