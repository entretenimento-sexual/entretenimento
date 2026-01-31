// src/app/core/services/batepapo/room-services/user-room-ids.service.ts
// Serviço para gerenciar IDs de salas associadas a usuários no Firestore
// Não esquecer os comentários
import { Injectable } from '@angular/core';
import { Firestore, doc, updateDoc, arrayUnion, arrayRemove } from '@angular/fire/firestore';
import { Observable, defer, of, firstValueFrom } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';

@Injectable({ providedIn: 'root' })
export class UserRoomIdsService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly firestoreError: FirestoreErrorHandlerService
  ) { }

  addRoomId$(userId: string, roomId: string): Observable<void> {
    const uid = (userId ?? '').trim();
    const rid = (roomId ?? '').trim();
    if (!uid || !rid) return of(void 0);

    return defer(() =>
      this.ctx.run(() =>
        updateDoc(doc(this.db, 'users', uid), { roomIds: arrayUnion(rid) } as any)
      )
    ).pipe(
      map(() => void 0),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  removeRoomId$(userId: string, roomId: string): Observable<void> {
    const uid = (userId ?? '').trim();
    const rid = (roomId ?? '').trim();
    if (!uid || !rid) return of(void 0);

    return defer(() =>
      this.ctx.run(() =>
        updateDoc(doc(this.db, 'users', uid), { roomIds: arrayRemove(rid) } as any)
      )
    ).pipe(
      map(() => void 0),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  /** ✅ API compatível com o seu RoomParticipantsService (Observable) */
  updateUserRoomIds$(userId: string, roomId: string, action: 'add' | 'remove'): Observable<void> {
    return of(action).pipe(
      switchMap(a => (a === 'add'
        ? this.addRoomId$(userId, roomId)
        : this.removeRoomId$(userId, roomId)
      ))
    );
  }

  /** ✅ API compatível com o seu RoomParticipantsService (Promise) */
  updateUserRoomIds(userId: string, roomId: string, action: 'add' | 'remove'): Promise<void> {
    return firstValueFrom(this.updateUserRoomIds$(userId, roomId, action));
  }
}
