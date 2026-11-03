// src/app/core/services/interactions/friendship/repo/blocks.repo.ts
// -----------------------------------------------------------------------------
// BLOCKS REPOSITORY — READ ONLY
// -----------------------------------------------------------------------------
// O cliente pode consultar seus próprios bloqueios conforme Firestore Rules.
// Escritas de block/unblock e eventos são exclusivamente Cloud Functions.
// -----------------------------------------------------------------------------

import { EnvironmentInjector, Injectable } from '@angular/core';
import {
  collection,
  doc,
  docData,
  Firestore,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { defer, map, Observable, throwError } from 'rxjs';

import {
  BlockedUserActive,
  BlockEvent,
} from '../../../../interfaces/friendship/blocked-user.interface';
import { FirestoreRepoBase } from './base.repo';

@Injectable({ providedIn: 'root' })
export class BlocksRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) {
    super(db, env);
  }

  private eventsCol(ownerUid: string, targetUid: string) {
    return collection(
      this.db,
      `users/${ownerUid}/blocks/${targetUid}/events`
    );
  }

  /**
   * Realtime of the owner's own block edge only. Incoming blocks are private.
   * Missing edge means not blocked; read failures must propagate to the UI.
   */
  watchBlocked(ownerUid: string, targetUid: string): Observable<boolean> {
    const owner = String(ownerUid ?? '').trim();
    const target = String(targetUid ?? '').trim();
    if (!owner || !target || owner === target || owner.includes('/') || target.includes('/')) {
      return throwError(() => new Error('Par inválido para leitura de bloqueio.'));
    }

    // FirestoreRepoBase.inCtx$ may infer Observable<Observable<T>> for a
    // listener. Use inCtxSync only to construct it inside Angular injection
    // context, then subscribe to the real docData stream with defer.
    return defer(() =>
      this.inCtxSync(() =>
        docData(doc(this.db, 'users', owner, 'blocks', target))
      )
    ).pipe(
      map((snapshot) => snapshot?.['isBlocked'] === true)
    );
  }

  listBlocked(uid: string) {
    return this.inCtx$(() =>
      getDocs(
        query(
          collection(this.db, `users/${uid}/blocks`),
          where('isBlocked', '==', true)
        )
      )
    ).pipe(
      map((snap) =>
        snap.docs.map((documentSnapshot) => {
          const { uid: _ignored, ...rest } =
            documentSnapshot.data() as BlockedUserActive;

          return {
            uid: documentSnapshot.id,
            ...rest,
          } satisfies BlockedUserActive;
        })
      )
    );
  }

  listBlockEvents(ownerUid: string, targetUid: string) {
    return this.inCtx$(() =>
      getDocs(this.eventsCol(ownerUid, targetUid))
    ).pipe(
      map((snap) =>
        snap.docs.map((documentSnapshot) =>
          documentSnapshot.data() as BlockEvent
        )
      )
    );
  }
}
