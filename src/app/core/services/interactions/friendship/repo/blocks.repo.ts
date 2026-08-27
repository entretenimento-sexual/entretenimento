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
  DocumentReference,
  Firestore,
  getDoc,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { map } from 'rxjs';

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

  private ref(
    ownerUid: string,
    targetUid: string
  ): DocumentReference<BlockedUserActive> {
    return doc(
      this.db,
      `users/${ownerUid}/blocks/${targetUid}`
    ) as DocumentReference<BlockedUserActive>;
  }

  private eventsCol(ownerUid: string, targetUid: string) {
    return collection(
      this.db,
      `users/${ownerUid}/blocks/${targetUid}/events`
    );
  }

  getBlockedDoc$(ownerUid: string, targetUid: string) {
    return this.inCtx$(() => getDoc(this.ref(ownerUid, targetUid)));
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
