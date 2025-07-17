// src/app/core/services/batepapo/rooms/room-participants.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, onSnapshot, getDoc, doc,
        runTransaction, Transaction,
        updateDoc,
        arrayUnion,
        arrayRemove} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { UsuarioService } from '../../user-profile/usuario.service';

@Injectable({
  providedIn: 'root',
})
export class RoomParticipantsService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService,
              private firestoreQuery: FirestoreQueryService,
              private usuarioService: UsuarioService,) { }

  /**
  * Obtém os participantes de uma sala.
  * @param roomId ID da sala.
  * @returns Observable com os participantes.
  */
  getParticipants(roomId: string): Observable<any[]> {
    const participantsRef = collection(this.db, `rooms/${roomId}/participants`);
    return new Observable((observer) => {
      const unsubscribe = onSnapshot(
        participantsRef,
        (snapshot) => {
          const participants = snapshot.docs.map((doc) => doc.data());
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
  * Aceita convite e adiciona usuário à sala.
  * @param inviteId ID do convite.
  * @param roomId ID da sala.
  * @param userId ID do usuário.
  */
  async acceptInviteAndJoinRoom(inviteId: string, roomId: string, userId: string): Promise<void> {
    const db = getFirestore();
    const inviteRef = doc(collection(db, 'invites'), inviteId);
    const roomRef = doc(collection(db, 'rooms'), roomId);

    await runTransaction(db, async (transaction: Transaction) => {
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
  * Aceita um convite e adiciona o usuário à sala.
  * @param roomId ID da sala.
  * @param inviteId ID do convite.
  * @param userId ID do usuário.
  * @returns Observable<void>
  */
  acceptInvite(roomId: string, inviteId: string, userId: string): Observable<void> {
    const roomRef = doc(this.db, 'rooms', roomId);
    const inviteRef = doc(this.db, 'invites', inviteId);

    return new Observable<void>((observer) => {
      runTransaction(this.db, async (transaction) => {
        // Recupera o documento da sala
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists()) {
          throw new Error('Sala não encontrada.');
        }

        // Adiciona o usuário à lista de participantes da sala
        const participants = roomSnapshot.data()?.['participants'] || [];
        if (!participants.includes(userId)) {
          transaction.update(roomRef, { participants: [...participants, userId] });
        }

        // Atualiza o status do convite para 'accepted'
        transaction.update(inviteRef, { status: 'accepted' });
      })
        .then(() => {
          console.log('Convite aceito e usuário adicionado à sala.');
          observer.next(); // Notifica sucesso
          observer.complete(); // Finaliza o Observable
        })
        .catch((error) => {
          console.log('Erro ao aceitar convite:', error);
          this.errorNotifier.showError('Erro ao aceitar convite.');
          observer.error(error); // Notifica erro
        });
    });
  }

  async addUserToRoom(userId: string, roomId: string): Promise<void> {
    // Atualizar lista de participantes na sala
    const roomRef = doc(this.firestoreQuery.getFirestoreInstance(), 'rooms', roomId);
    await updateDoc(roomRef, { participants: arrayUnion(userId) });

    // Atualizar o campo roomIds no usuário
    await this.usuarioService.updateUserRoomIds(userId, roomId, 'add');
  }

  async removeUserFromRoom(userId: string, roomId: string): Promise<void> {
    // Remover participante da sala
    const roomRef = doc(this.firestoreQuery.getFirestoreInstance(), 'rooms', roomId);
    await updateDoc(roomRef, { participants: arrayRemove(userId) });

    // Atualizar o campo roomIds no usuário
    await this.usuarioService.updateUserRoomIds(userId, roomId, 'remove');
  }

  /**
   * Obtém informações do criador de uma sala.
   * @param roomId ID da sala.
   * @returns Observable contendo os dados do criador.
   */
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
