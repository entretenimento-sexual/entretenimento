import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  getDocs,
  limit,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';

import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';

export type RoomFirestoreDocument = Partial<IRoom> & {
  id?: unknown;
  roomId?: unknown;
  roomName?: unknown;
  createdBy?: unknown;
  participants?: unknown;
  creationTime?: unknown;
  lastActivity?: unknown;
  description?: unknown;
  isPrivate?: unknown;
  roomType?: unknown;
  visibility?: unknown;
  status?: unknown;
  memberCount?: unknown;
  membershipMode?: unknown;
  policyVersion?: unknown;
};

@Injectable({ providedIn: 'root' })
export class RoomFirestoreGateway {
  private readonly db = inject(Firestore);
  private readonly ctx = inject(FirestoreContextService);

  fetchOwnedRooms$(uid: string): Observable<RoomFirestoreDocument[]> {
    return this.ctx
      .deferPromise$(() => {
        const roomsRef = collection(this.db, 'rooms');
        const ownedRoomsQuery = query(
          roomsRef,
          where('createdBy', '==', uid)
        );

        return getDocs(ownedRoomsQuery);
      })
      .pipe(
        map((snapshot) =>
          snapshot.docs.map(
            (documentSnapshot) =>
              documentSnapshot.data() as RoomFirestoreDocument
          )
        )
      );
  }

  watchOwnedRooms$(uid: string): Observable<RoomFirestoreDocument[]> {
    return this.ctx.deferObservable$(() => {
      const roomsRef = collection(this.db, 'rooms');
      const ownershipQuery = query(
        roomsRef,
        where('createdBy', '==', uid)
      );

      return collectionData(ownershipQuery, {
        idField: 'id',
      }) as Observable<RoomFirestoreDocument[]>;
    });
  }

  watchMemberRooms$(uid: string): Observable<RoomFirestoreDocument[]> {
    return this.ctx.deferObservable$(() => {
      const roomsRef = collection(this.db, 'rooms');
      const membershipQuery = query(
        roomsRef,
        where('participants', 'array-contains', uid),
        limit(30)
      );

      return collectionData(membershipQuery, {
        idField: 'id',
      }) as Observable<RoomFirestoreDocument[]>;
    });
  }

  watchRoom$(roomId: string): Observable<RoomFirestoreDocument | undefined> {
    return this.ctx.deferObservable$(() => {
      const roomRef = doc(this.db, 'rooms', roomId);

      return docData(roomRef, {
        idField: 'id',
      }) as Observable<RoomFirestoreDocument | undefined>;
    });
  }
}
