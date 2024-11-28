// src/app/core/services/batepapo/invite.service.ts
import { Injectable, Inject } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { Invite } from '../../interfaces/interfaces-chat/invite.interface';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { DistanceCalculationService } from '../geolocation/distance-calculation.service';
import { IUserDados } from '../../interfaces/iuser-dados';

@Injectable({
  providedIn: 'root',
})
export class InviteService {
  constructor(
    private firestore: AngularFirestore,
    private errorNotifier: ErrorNotificationService,
    @Inject(DistanceCalculationService) private distanceService: DistanceCalculationService
  ) { }

  /**
   * Envia convites para usuários próximos.
   * @param inviter Dados do convidante.
   * @param roomId ID da sala.
   * @param roomName Nome da sala.
   * @param maxDistanceKm Distância máxima para considerar proximidade.
   */
  async sendInvitesToNearbyUsers(
    inviter: IUserDados,
    roomId: string,
    roomName: string,
    maxDistanceKm: number = 50
  ): Promise<void> {
    try {
      const usersSnapshot = await this.firestore.collection<IUserDados>('users').ref.get();
      const nearbyUsers: IUserDados[] = [];

      usersSnapshot.forEach((doc) => {
        const user = doc.data();
        if (user.uid !== inviter.uid && user.latitude && user.longitude) {
          const distance = this.distanceService.calculateDistanceInKm(
            inviter.latitude!,
            inviter.longitude!,
            user.latitude,
            user.longitude,
            maxDistanceKm
          );

          if (distance !== null) {
            nearbyUsers.push({ ...user, distanciaKm: distance });
          }
        }
      });
      const currentTimestamp = new Date();
      const invitePromises = nearbyUsers.map((user) =>
        this.sendInvite(
          {
            roomId,
            receiverId: user.uid,
            senderId: inviter.uid,
            status: 'pending',
            sentAt: Timestamp.fromDate(currentTimestamp),
            expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
          },
          roomName,
          inviter.role
        )
      );

      await Promise.all(invitePromises);
      console.log('Convites enviados para usuários próximos.');
    } catch (error) {
      this.errorNotifier.showError('Erro ao enviar convites.');
      throw error;
    }
  }

  //Envia um convite para um usuário.
  async sendInvite(
    inviteData: Omit<Invite, 'id' | 'roomName'> & { sentAt: Timestamp | any; expiresAt: Timestamp | any },
    roomName: string,
    inviterRole: 'visitante' | 'free' | 'basico' | 'premium' | 'vip'
  ): Promise<void> {
    if (!this.isRoleAllowedToInvite(inviterRole)) {
      this.errorNotifier.showError('Seu plano atual não permite enviar convites.');
      throw new Error('Permissão negada.');
    }

    const existingInvite = await this.firestore
      .collection('invites', (ref) =>
        ref
          .where('receiverId', '==', inviteData.receiverId)
          .where('roomId', '==', inviteData.roomId)
          .where('status', '==', 'pending')
      )
      .get()
      .toPromise();

    if (existingInvite && !existingInvite.empty) {
      console.warn('Convite pendente já existe.');
      return;
    }

    const normalizedInvite = {
      ...inviteData,
      sentAt: inviteData.sentAt instanceof Timestamp ? inviteData.sentAt : Timestamp.fromDate(new Date()),
      expiresAt: inviteData.expiresAt instanceof Timestamp ? inviteData.expiresAt : Timestamp.fromDate(new Date()),
    };

    try {
      await this.firestore.collection('invites').add({
        ...normalizedInvite,
        roomName,
      });
      console.log('Convite enviado com sucesso.');
    } catch (error) {
      this.errorNotifier.showError('Erro ao enviar convite.');
      throw error;
    }
  }


  //Obtém convites de um usuário.
  getInvites(userId: string, status?: 'pending' | 'accepted' | 'declined'): Observable<Invite[]> {
    return this.firestore.collection<Invite>('invites', (ref) => {
      let query = ref.where('receiverId', '==', userId);
      if (status) query = query.where('status', '==', status);
      return query;
    }).valueChanges({ idField: 'id' });
  }

  /**
   * Atualiza o status de um convite.
   */
  async updateInviteStatus(inviteId: string, status: 'accepted' | 'declined'): Promise<void> {
    const inviteRef = this.firestore.doc(`invites/${inviteId}`);
    try {
      await inviteRef.update({ status });
      console.log('Status do convite atualizado.');
    } catch (error) {
      this.errorNotifier.showError('Erro ao atualizar convite.');
      throw error;
    }
  }

  /**
   * Verifica se o role pode enviar convites.
   */
  private isRoleAllowedToInvite(role: 'visitante' | 'free' | 'basico' | 'premium' | 'vip'): boolean {
    const allowedRoles = ['basico', 'premium', 'vip'];
    return allowedRoles.includes(role);
  }
}
