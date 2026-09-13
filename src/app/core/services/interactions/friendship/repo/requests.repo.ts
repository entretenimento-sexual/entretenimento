// src/app/core/services/interactions/friendship/repo/requests.repo.ts
// -----------------------------------------------------------------------------
// FRIEND REQUESTS REPOSITORY — READ ONLY
// -----------------------------------------------------------------------------
// O cliente consulta solicitações de amizade, mas nunca altera seu lifecycle.
// Criar, aceitar, recusar e cancelar são operações exclusivas das Cloud Functions.
// -----------------------------------------------------------------------------
import { EnvironmentInjector, Injectable } from '@angular/core';
import {
  collection,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import {
  onSnapshot,
  Query as FsQuery,
} from 'firebase/firestore';
import { map, Observable } from 'rxjs';

import { FriendRequest } from '../../../../interfaces/friendship/friend-request.interface';
import { FirestoreRepoBase } from './base.repo';

@Injectable({ providedIn: 'root' })
export class RequestsRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) {
    super(db, env);
  }

  getDocExists(path: string) {
    return this.inCtx$(() => getDoc(doc(this.db, path))).pipe(
      map((snapshot) => snapshot.exists())
    );
  }

  listInboundRequests(uid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(
        colRef,
        where('targetUid', '==', uid),
        where('status', '==', 'pending')
      );
      return getDocs(qRef);
    }).pipe(
      map((snapshot) =>
        snapshot.docs.map((documentSnapshot) => {
          const data = documentSnapshot.data() as Omit<FriendRequest, 'id'>;
          return { id: documentSnapshot.id, ...data };
        })
      )
    );
  }

  listOutboundRequests(uid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(
        colRef,
        where('requesterUid', '==', uid),
        where('status', '==', 'pending')
      );
      return getDocs(qRef);
    }).pipe(
      map((snapshot) =>
        snapshot.docs.map((documentSnapshot) => {
          const data = documentSnapshot.data() as Omit<FriendRequest, 'id'>;
          return { id: documentSnapshot.id, ...data };
        })
      )
    );
  }

  findDuplicatePending(requesterUid: string, targetUid: string) {
    return this.inCtx$(() => {
      const colRef = collection(this.db, 'friendRequests');
      const qRef = query(
        colRef,
        where('requesterUid', '==', requesterUid),
        where('targetUid', '==', targetUid),
        where('status', '==', 'pending')
      );
      return getDocs(qRef);
    });
  }

  watchInboundRequests(
    uid: string
  ): Observable<(FriendRequest & { id: string })[]> {
    return new Observable((subscriber) => {
      const unsubscribe = this.inCtxSync(() => {
        const colRef = collection(this.db, 'friendRequests');
        const qRef = query(
          colRef,
          where('targetUid', '==', uid),
          where('status', '==', 'pending')
        ) as unknown as FsQuery;

        return onSnapshot(
          qRef,
          (snapshot) =>
            subscriber.next(
              snapshot.docs.map((documentSnapshot) => {
                const data = documentSnapshot.data() as Omit<FriendRequest, 'id'>;
                return { id: documentSnapshot.id, ...data };
              })
            ),
          (error) => subscriber.error(error)
        );
      });

      return () => unsubscribe?.();
    });
  }

  watchOutboundRequests(
    uid: string
  ): Observable<(FriendRequest & { id: string })[]> {
    return new Observable((subscriber) => {
      const unsubscribe = this.inCtxSync(() => {
        const colRef = collection(this.db, 'friendRequests');
        const qRef = query(
          colRef,
          where('requesterUid', '==', uid),
          where('status', '==', 'pending')
        ) as unknown as FsQuery;

        return onSnapshot(
          qRef,
          (snapshot) =>
            subscriber.next(
              snapshot.docs.map((documentSnapshot) => {
                const data = documentSnapshot.data() as Omit<FriendRequest, 'id'>;
                return { id: documentSnapshot.id, ...data };
              })
            ),
          (error) => subscriber.error(error)
        );
      });

      return () => unsubscribe?.();
    });
  }
}
