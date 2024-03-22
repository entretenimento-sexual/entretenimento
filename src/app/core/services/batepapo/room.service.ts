// src\app\core\services\batepapo\room.service.ts
import { Injectable } from '@angular/core';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { Observable, switchMap, throwError } from 'rxjs';
import { AuthService } from '../autentication/auth.service';
import {
  addDoc, collection, Timestamp, getFirestore, query, where, getDocs
} from 'firebase/firestore';
import { UsuarioStateService } from '../autentication/usuario-state.service';
import { RoomCreationConfirmationModalComponent } from 'src/app/chat-module/room-creation-confirmation-modal/room-creation-confirmation-modal.component';

@Injectable({
  providedIn: 'root'
})
export class RoomService {
  private db = getFirestore();

  constructor(
    private authService: AuthService,
    private subscriptionService: SubscriptionService,
    private usuarioStateService: UsuarioStateService
  ) { }

  public async countUserRooms(userId: string): Promise<number> {
    const roomsRef = collection(this.db, 'rooms');
    const q = query(roomsRef, where('createdBy', '==', userId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.length;
    return querySnapshot.docs.length;
  }

  createRoom(roomDetails: any): Observable<any> {
    return this.usuarioStateService.user$.pipe(
      switchMap(async (user) => {
        if (!user) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        if (!this.canCreateRoomBasedOnRole(user.role)) {
          this.subscriptionService.promptSubscription({
            title: "Exclusivo para certos roles",
            message: "Apenas usuários com certos roles podem criar salas. Deseja atualizar seu role ou assinatura?"
          });
          return throwError(() => new Error('Acesso negado: apenas usuários com roles específicos podem criar salas de bate-papo.'));
        }

        const roomCount = await this.countUserRooms(user.uid);
        const MAX_ROOMS_ALLOWED = 1; // Define o limite de salas por usuário
        if (roomCount >= MAX_ROOMS_ALLOWED) {
          return throwError(() => new Error('Limite de salas criadas por usuário alcançado.'));
        }

        const roomExpiration = user.isSubscriber ?
          (user.roomCreationSubscriptionExpires ?? Timestamp.fromDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))) :
          Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 30)));

        const roomData = {
          ...roomDetails,
          expirationDate: roomExpiration,
          createdBy: user.uid
        };

        try {
          const docRef = await addDoc(collection(this.db, 'rooms'), roomData);
          return { roomId: docRef.id, ...roomData, roomCount: await this.countUserRooms(user.uid)};
        } catch (error) {
          return throwError(() => error);
        }
      })
    );
  }

  private canCreateRoomBasedOnRole(role: string): boolean {
    return ['premium', 'vip'].includes(role);
  }
}
