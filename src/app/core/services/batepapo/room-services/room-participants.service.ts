// src/app/core/services/batepapo/rooms/room-participants.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class RoomParticipantsService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService) { }

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
