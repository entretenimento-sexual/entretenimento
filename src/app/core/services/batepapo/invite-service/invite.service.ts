// src/app/core/services/batepapo/invite.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, doc, getDocs, query, where, runTransaction,
         updateDoc, addDoc, Timestamp, setDoc,} from 'firebase/firestore';
import { Observable, from, throwError, forkJoin } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { DistanceCalculationService } from '../../geolocation/distance-calculation.service';

@Injectable({
  providedIn: 'root',
})
export class InviteService {
  private db = getFirestore();

  constructor(
    private errorNotifier: ErrorNotificationService,
    private firestoreQuery: FirestoreQueryService,
    private distanceService: DistanceCalculationService
  ) { }

  /**
 * Envia um convite individual.
 * @param invite Dados do convite.
 * @returns Promise<void>
 */
  sendInvite(invite: Invite): Promise<void> {
    return addDoc(collection(this.db, 'invites'), invite)
      .then(() => {
        console.log(`Convite enviado com sucesso para ${invite.receiverId}`);
      })
      .catch((error) => {
        console.error(`Erro ao enviar convite para ${invite.receiverId}:`, error);
        this.errorNotifier.showError('Erro ao enviar convite.');
        throw error;
      });
  }

  sendInviteToRoom(roomId: string, inviteData: Invite): Observable<void> {
    const inviteRef = doc(collection(this.db, `rooms/${roomId}/invites`));
    return from(setDoc(inviteRef, inviteData)).pipe(
      map(() => {
        console.log(`Convite enviado para a sala ${roomId}`);
      }),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }


  /**
   * Envia convites para usuários próximos.
   * Utiliza FirestoreQueryService para buscar usuários.
   * @param roomId ID da sala.
   * @param roomName Nome da sala.
   * @param inviter Dados do convidante.
   * @param maxDistanceKm Distância máxima para considerar proximidade.
   */
  sendInvitesToNearbyUsers(
    roomId: string,
    roomName: string,
    inviter: IUserDados,
    maxDistanceKm: number = 50
  ): Observable<void> {
    if (!inviter?.uid || !inviter.latitude || !inviter.longitude) {
      this.errorNotifier.showError('Dados do convidante inválidos.');
      return throwError(() => new Error('Dados do convidante inválidos.'));
    }

    return from(
      this.firestoreQuery.searchUsers([
        where('latitude', '>', 0),
        where('longitude', '>', 0),
      ])
    ).pipe(
      map((users) =>
        users.filter((user) => {
          const distance = this.distanceService.calculateDistanceInKm(
            inviter.latitude!,
            inviter.longitude!,
            user.latitude!,
            user.longitude!,
            maxDistanceKm
          );
          return user.uid !== inviter.uid && distance !== null;
        })
      ),
      switchMap((nearbyUsers) => {
        const currentTimestamp = Timestamp.fromDate(new Date());
        const expirationTimestamp = Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        );

        // Cria um array de Observables para todos os convites
        const inviteObservables = nearbyUsers.map((user) =>
          this.createInvite({
            roomId,
            roomName,
            receiverId: user.uid,
            senderId: inviter.uid,
            status: 'pending',
            sentAt: currentTimestamp,
            expiresAt: expirationTimestamp,
          })
        );

        // Usa forkJoin para processar todos os Observables de forma combinada
        return forkJoin(inviteObservables).pipe(map(() => void 0));
      }),
      tap(() => console.log('Convites enviados com sucesso.')),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao enviar convites.');
        return throwError(() => error);
      })
    );
  }

  /**
   * Cria um convite no Firestore.
   * @param inviteData Dados do convite.
   */
  createInvite(inviteData: Invite): Observable<void> {
    return from(addDoc(collection(this.db, 'invites'), inviteData)).pipe(
      map(() => {
        console.log('Convite criado com sucesso.');
      }),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao criar convite.');
        return throwError(() => error);
      })
    );
  }

  /**
   * Atualiza o status de um convite.
   * @param roomId ID da sala.
   * @param inviteId ID do convite.
   * @param status Novo status ('accepted' | 'declined').
   */
  updateInviteStatus(
    roomId: string,
    inviteId: string,
    status: 'accepted' | 'declined'
  ): Observable<void> {
    const inviteRef = doc(this.db, `rooms/${roomId}/invites/${inviteId}`);
    return from(updateDoc(inviteRef, { status })).pipe(
      map(() => {
        console.log('Status do convite atualizado com sucesso.');
      }),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao atualizar status do convite.');
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtém convites de um usuário.
   * @param userId ID do usuário.
   * @returns Observable com os convites.
   */
  getInvites(userId: string): Observable<Invite[]> {
    const invitesQuery = query(
      collection(this.db, 'invites'),
      where('receiverId', '==', userId)
    );

    return from(getDocs(invitesQuery)).pipe(
      map((snapshot) => snapshot.docs.map((doc) => doc.data() as Invite)),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao carregar convites.');
        return throwError(() => error);
      })
    );
  }

  /**
   * Verifica se o role pode enviar convites.
   * @param role Papel do usuário.
   */
  private isRoleAllowedToInvite(
    role: 'visitante' | 'free' | 'basico' | 'premium' | 'vip'
  ): boolean {
    const allowedRoles = ['basico', 'premium', 'vip'];
    return allowedRoles.includes(role);
  }

  /**
   * Envia um convite usando transação.
   * @param invite Dados do convite.
   */
  sendInviteWithTransaction(invite: Invite): Observable<void> {
    return from(
      runTransaction(this.db, async (transaction) => {
        const inviteRef = doc(collection(this.db, 'invites'));

        const existingInviteQuery = query(
          collection(this.db, 'invites'),
          where('receiverId', '==', invite.receiverId),
          where('roomId', '==', invite.roomId)
        );
        const existingInviteSnapshot = await getDocs(existingInviteQuery);

        if (!existingInviteSnapshot.empty) {
          throw new Error('Convite já existente.');
        }

        transaction.set(inviteRef, invite);
      })
    ).pipe(
      map(() => {
        console.log('Convite enviado com sucesso.');
      }),
      catchError((error) => {
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }
}
