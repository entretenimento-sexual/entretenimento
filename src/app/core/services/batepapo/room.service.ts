// src\app\core\services\batepapo\room.service.ts
import { Injectable } from '@angular/core';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { Observable, switchMap, throwError } from 'rxjs';
import {
  addDoc, collection, Timestamp, getFirestore, query, where, getDocs, serverTimestamp, updateDoc, doc
} from 'firebase/firestore';
import { UsuarioStateService } from '../autentication/usuario-state.service';

@Injectable({
  providedIn: 'root'
})
export class RoomService {
  private db = getFirestore();

  constructor(
    private subscriptionService: SubscriptionService,
    private usuarioStateService: UsuarioStateService
  ) { }

  public async countUserRooms(userId: string): Promise<number> {
    const roomsCollectionRef = collection(this.db, 'rooms');
    const userRoomsQuery = query(roomsCollectionRef, where('createdBy', '==', userId));
    const userRoomsSnapshot = await getDocs(userRoomsQuery);
    return userRoomsSnapshot.docs.length;
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

  async getUserRooms(userId: string): Promise<any[]> {
    const roomsCollectionRef = collection(this.db, 'rooms');
    const roomsCreatedByUserQuery = query(roomsCollectionRef, where('createdBy', '==', userId));
    const roomsSnapshot = await getDocs(roomsCreatedByUserQuery);
    const roomsData = roomsSnapshot.docs.map(roomDoc => ({
      roomId: roomDoc.id, // Alterado para 'roomId' para maior clareza
      ...roomDoc.data()
    }));

    return roomsData;
  }

  async sendInvite(roomId: string): Promise<void> {
    const inviteDoc = {
      roomId: roomId,
      status: 'sent',
      sentTime: serverTimestamp(), // Data/hora atual
      // Incluir mais detalhes conforme necessário
    };

    // Adiciona o convite à coleção de convites
    await addDoc(collection(this.db, 'invites'), inviteDoc);
  }

  async updateRoom(roomId: string, roomDetails: any): Promise<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    await updateDoc(roomRef, roomDetails);
  }
}
