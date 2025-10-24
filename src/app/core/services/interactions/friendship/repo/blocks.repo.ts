// src/app/core/services/interactions/friendship/repo/blocks.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore, doc, getDoc, setDoc, updateDoc, collection, getDocs,
  DocumentReference, addDoc, serverTimestamp, query, where
} from '@angular/fire/firestore';
import { FirestoreRepoBase } from './base.repo';
import { BlockedUserActive, BlockEvent } from '../../../../interfaces/friendship/blocked-user.interface';
import { map, concatMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BlocksRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) { super(db, env); }

  private ref(ownerUid: string, targetUid: string): DocumentReference<BlockedUserActive> {
    return doc(this.db, `users/${ownerUid}/blocks/${targetUid}`) as DocumentReference<BlockedUserActive>;
  }

  private eventsCol(ownerUid: string, targetUid: string) {
    return collection(this.db, `users/${ownerUid}/blocks/${targetUid}/events`);
  }

  getBlockedDoc$(ownerUid: string, targetUid: string) {
    return this.inCtx$(() => getDoc(this.ref(ownerUid, targetUid)));
  }

  listBlocked(uid: string) {
    return this.inCtx$(() =>
      getDocs(query(collection(this.db, `users/${uid}/blocks`), where('isBlocked', '==', true)))
    ).pipe(
      map(snap =>
        snap.docs.map(d => {
          const { uid: _ignored, ...rest } = d.data() as BlockedUserActive; // elimina uid do data()
          return { uid: d.id, ...rest } satisfies BlockedUserActive;        // injeta o id do doc
        })
      )
    );
  }

  listBlockEvents(ownerUid: string, targetUid: string) {
    return this.inCtx$(() => getDocs(this.eventsCol(ownerUid, targetUid)))
      .pipe(map(snap => snap.docs.map(d => d.data() as BlockEvent)));
  }

  private appendEvent(ownerUid: string, targetUid: string, evt: Omit<BlockEvent, 'createdAt' | 'targetUid'>) {
    const payload: BlockEvent = { ...evt, targetUid, createdAt: serverTimestamp() as any };
    return this.inCtx$(() => addDoc(this.eventsCol(ownerUid, targetUid), payload)).pipe(map(() => void 0));
  }

  /** Bloquear + evento */
  blockUser(ownerUid: string, targetUid: string, reason?: string) {
    const ref = this.ref(ownerUid, targetUid);
    const state: Partial<BlockedUserActive> = {
      uid: targetUid,
      isBlocked: true,
      blockedAt: serverTimestamp() as any,
      reason,
      actorUid: ownerUid,
      updatedAt: serverTimestamp() as any,
    };

    return this.inCtx$(() => setDoc(ref, state, { merge: true })).pipe(
      concatMap(() => this.appendEvent(ownerUid, targetUid, { type: 'block', actorUid: ownerUid, reason }))
    );
  }

  /** Desbloquear + evento */
  unblockUser(ownerUid: string, targetUid: string) {
    const ref = this.ref(ownerUid, targetUid);
    const patch: Partial<BlockedUserActive> = {
      isBlocked: false,
      unblockedAt: serverTimestamp() as any,
      actorUid: ownerUid,
      updatedAt: serverTimestamp() as any,
    };

    return this.inCtx$(() => updateDoc(ref, patch)).pipe(
      concatMap(() => this.appendEvent(ownerUid, targetUid, { type: 'unblock', actorUid: ownerUid }))
    );
  }
}
