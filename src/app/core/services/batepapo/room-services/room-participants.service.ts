// src/app/core/services/batepapo/rooms/room-participants.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, onSnapshot, getDoc, doc, runTransaction,
         Transaction, updateDoc,  arrayUnion, arrayRemove,} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { UsuarioService } from '../../user-profile/usuario.service';

@Injectable({ providedIn: 'root' })
export class RoomParticipantsService {

  constructor(
    private db: Firestore,
    private errorNotifier: ErrorNotificationService,
    private firestoreQuery: FirestoreQueryService,
    private usuarioService: UsuarioService,
  ) { }

  /** Obtém os participantes de uma sala. */
  getParticipants(roomId: string): Observable<any[]> {
    const participantsRef = collection(this.db, `rooms/${roomId}/participants`);
    return new Observable((observer) => {
      const unsubscribe = onSnapshot(
        participantsRef,
        (snapshot) => {
          const participants = snapshot.docs.map((d) => d.data());
          observer.next(participants);
        },
        (error) => {
          this.errorNotifier.showError('Erro ao carregar participantes.');
          observer.error(error);
        }
      );
      return () => unsubscribe();
    });
  }

  /**
   * Aceita convite e adiciona usuário à sala (transação).
   */
  async acceptInviteAndJoinRoom(inviteId: string, roomId: string, userId: string): Promise<void> {
    const inviteRef = doc(collection(this.db, 'invites'), inviteId);
    const roomRef = doc(collection(this.db, 'rooms'), roomId);

    await runTransaction(this.db, async (transaction: Transaction) => {
      const inviteDoc = await transaction.get(inviteRef);
      if (!inviteDoc.exists()) throw new Error('Convite não encontrado.');

      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists()) throw new Error('Sala não encontrada.');

      const roomData = roomDoc.data();
      const participants = roomData?.['participants'] || [];
      if (!participants.includes(userId)) {
        transaction.update(roomRef, { participants: [...participants, userId] });
      }

      transaction.update(inviteRef, { status: 'accepted' });
    });
  }

  /**
   * Aceita um convite e adiciona o usuário à sala (Observable).
   */
  acceptInvite(roomId: string, inviteId: string, userId: string): Observable<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    const inviteRef = doc(this.db, 'invites', inviteId);

    return new Observable<void>((observer) => {
      runTransaction(this.db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists()) throw new Error('Sala não encontrada.');

        const participants = roomSnapshot.data()?.['participants'] || [];
        if (!participants.includes(userId)) {
          transaction.update(roomRef, { participants: [...participants, userId] });
        }

        transaction.update(inviteRef, { status: 'accepted' });
      })
        .then(() => {
          console.log('Convite aceito e usuário adicionado à sala.');
          observer.next();
          observer.complete();
        })
        .catch((error) => {
          console.log('Erro ao aceitar convite:', error);
          this.errorNotifier.showError('Erro ao aceitar convite.');
          observer.error(error);
        });
    });
  }

  async addUserToRoom(userId: string, roomId: string): Promise<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    await updateDoc(roomRef, { participants: arrayUnion(userId) });
    await this.usuarioService.updateUserRoomIds(userId, roomId, 'add');
  }

  async removeUserFromRoom(userId: string, roomId: string): Promise<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    await updateDoc(roomRef, { participants: arrayRemove(userId) });
    await this.usuarioService.updateUserRoomIds(userId, roomId, 'remove');
  }

  /** Obtém informações do criador de uma sala. */
  getRoomCreator(roomId: string): Observable<IUserDados> {
    return new Observable((observer) => {
      const roomRef = doc(this.db, 'rooms', roomId);

      getDoc(roomRef)
        .then((roomSnapshot) => {
          if (!roomSnapshot.exists()) {
            this.errorNotifier.showError('Sala não encontrada.');
            observer.error('Sala não encontrada.');
            return;
          }

          const creatorId = roomSnapshot.data()?.['createdBy'];
          if (!creatorId) {
            this.errorNotifier.showError('Criador da sala não encontrado.');
            observer.error('Criador da sala não encontrado.');
            return;
          }

          const userRef = doc(this.db, 'users', creatorId);
          getDoc(userRef)
            .then((userSnapshot) => {
              if (userSnapshot.exists()) {
                observer.next(userSnapshot.data() as IUserDados);
                observer.complete();
              } else {
                this.errorNotifier.showError('Criador da sala não encontrado.');
                observer.error('Criador da sala não encontrado.');
              }
            })
            .catch((err) => {
              this.errorNotifier.showError('Erro ao buscar criador.');
              observer.error(err);
            });
        })
        .catch((err) => {
          this.errorNotifier.showError('Erro ao buscar sala.');
          observer.error(err);
        });
    });
  }
}
