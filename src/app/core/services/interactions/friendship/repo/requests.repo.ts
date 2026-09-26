// src/app/core/services/interactions/friendship/repo/requests.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  from,
  map,
  switchMap,
  timer,
} from 'rxjs';

import { FirestoreRepoBase } from './base.repo';
import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';

/**
 * Repositório de leitura das solicitações de amizade.
 *
 * Escritas são backend-only e passam pelos callables expostos por
 * FriendshipService. Manter writes Firestore aqui recriaria uma segunda
 * autoridade de lifecycle no cliente.
 */
@Injectable({ providedIn: 'root' })
export class RequestsRepo extends FirestoreRepoBase {
  constructor(
    db: Firestore,
    env: EnvironmentInjector,
    private readonly functions: Functions
  ) {
    super(db, env);
  }

  private getPendingRequestsCallable() {
    return this.inCtxSync(() =>
      httpsCallable<
        { direction: 'inbound' | 'outbound'; limit: number },
        {
          items: (FriendRequest & { id: string })[];
          fetchedAt: number;
          scanned: number;
        }
      >(this.functions, 'getPendingFriendRequests')
    );
  }

  /* =========================
   * LISTAGENS (pendentes)
   * ========================= */
  listInboundRequests(_uid: string) {
    return defer(() =>
      from(
        this.getPendingRequestsCallable()({
          direction: 'inbound',
          limit: 60,
        })
      )
    ).pipe(map((response) => response.data.items ?? []));
  }

  listOutboundRequests(_uid: string) {
    return defer(() =>
      from(
        this.getPendingRequestsCallable()({
          direction: 'outbound',
          limit: 60,
        })
      )
    ).pipe(map((response) => response.data.items ?? []));
  }

  /* =========================
   * REALTIME WATCHERS
   * ========================= */
  watchInboundRequests(_uid: string): Observable<(FriendRequest & { id: string })[]> {
    return timer(0, 60_000).pipe(
      switchMap(() => this.listInboundRequests(''))
    );
  }

  watchOutboundRequests(_uid: string): Observable<(FriendRequest & { id: string })[]> {
    return timer(0, 60_000).pipe(
      switchMap(() => this.listOutboundRequests(''))
    );
  }

}
