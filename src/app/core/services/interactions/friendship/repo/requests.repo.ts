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
  filter,
  takeUntil,
} from 'rxjs';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SessionReadInFlight } from '@core/services/autentication/auth/session-read-in-flight';

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
  private readonly inFlight: SessionReadInFlight<(FriendRequest & { id: string })[]>;
  constructor(
    db: Firestore,
    env: EnvironmentInjector,
    private readonly functions: Functions,
    private readonly session: AuthSessionService
  ) {
    super(db, env);
    this.inFlight = new SessionReadInFlight(this.session);
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
  listInboundRequests(uid: string) {
    return this.listPendingRequests$(uid, 'inbound');
  }

  listOutboundRequests(uid: string) {
    return this.listPendingRequests$(uid, 'outbound');
  }

  private listPendingRequests$(uid: string, direction: 'inbound' | 'outbound') {
    return this.inFlight.read$(direction, () =>
      defer(() => from(this.getPendingRequestsCallable()({ direction, limit: 60 })))
        .pipe(map((response) => response.data.items ?? [])),
      uid
    );
  }

  /* =========================
   * REALTIME WATCHERS
   * ========================= */
  watchInboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.watchPendingRequests$(uid, 'inbound');
  }

  watchOutboundRequests(uid: string): Observable<(FriendRequest & { id: string })[]> {
    return this.watchPendingRequests$(uid, 'outbound');
  }

  private watchPendingRequests$(uid: string, direction: 'inbound' | 'outbound') {
    return defer(() => {
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      return timer(0, 60_000).pipe(
        switchMap(() => this.listPendingRequests$(uid, direction)),
        takeUntil(this.session.uid$.pipe(filter(activeUid =>
          activeUid !== uid || this.session.currentAuthUser !== user ||
          this.session.terminationVersionSnapshot !== version ||
          this.session.isTerminatingSnapshot
        )))
      );
    });
  }
}
