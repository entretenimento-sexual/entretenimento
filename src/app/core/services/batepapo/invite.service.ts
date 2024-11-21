// src/app/core/services/batepapo/invite.service.ts
import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { Invite } from '../../interfaces/interfaces-chat/invite.interface';
import { Timestamp, serverTimestamp } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class InviteService {
  constructor(private firestore: AngularFirestore) { }

  // Envia um convite para um usuário
  async sendInvite(inviteData: Omit<Invite, 'id' | 'roomName'>, roomName: string): Promise<void> {
    console.log('Enviando convite com dados:', inviteData, ' para a sala:', roomName);
    const invite = {
      ...inviteData,
      roomName,
      sentAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) // 7 dias
    };
    await this.firestore.collection('invites').add(invite);
    console.log('Convite enviado com sucesso.');
  }

  // Obtém convites do usuário, com filtro opcional por status
  getInvites(userId: string, status?: 'pending' | 'accepted' | 'declined'): Observable<Invite[]> {
    console.log('Obtendo convites para o usuário com ID:', userId, 'e status:', status || 'todos');
    return this.firestore.collection<Invite>('invites', ref => {
      let query = ref.where('receiverId', '==', userId);
      if (status) {
        query = query.where('status', '==', status);
      }
      return query;
    }).valueChanges({ idField: 'id' });
  }

  // Atualiza o status de um convite
  async updateInviteStatus(inviteId: string, status: 'accepted' | 'declined'): Promise<void> {
    console.log('Atualizando status do convite ID:', inviteId, 'para o status:', status);
    const inviteRef = this.firestore.doc(`invites/${inviteId}`);
    await inviteRef.update({ status });
    console.log('Convite atualizado com sucesso.');
  }
}
