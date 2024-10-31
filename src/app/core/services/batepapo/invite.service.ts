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

  async sendInvite(inviteData: Omit<Invite, 'id' | 'roomName'>, roomName: string): Promise<void> {
    console.log('Enviando convite com dados:', inviteData, ' para a sala:', roomName);
    const invite = {
      ...inviteData,
      roomName: roomName,
      sentAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
    };
    await this.firestore.collection('invites').add(invite);
  }

  // Adicionando o método `getInvites`
  getInvites(userId: string): Observable<Invite[]> {
    console.log('Obtendo convites para o usuário com ID:', userId);
    return this.firestore.collection<Invite>('invites', ref => ref.where('receiverId', '==', userId)).valueChanges();
  }

  async updateInviteStatus(inviteId: string, status: 'accepted' | 'declined'): Promise<void> {
    console.log('Atualizando status do convite ID:', inviteId, 'para o status:', status);
    const inviteRef = this.firestore.doc(`invites/${inviteId}`);
    await inviteRef.update({ status: status });
  }

  observeInvites(userId: string): Observable<Invite[]> {
    console.log('Observando convites pendentes para o usuário ID:', userId);
    return this.firestore.collection<Invite>('invites', ref => ref.where('receiverId', '==', userId).where('status', '==', 'pending')).valueChanges({ idField: 'id' });
  }

  // Adicionando `acceptInvite` e `declineInvite`
  acceptInvite(inviteId: string): Promise<void> {
    console.log('Aceitando convite com ID:', inviteId);
    return this.updateInviteStatus(inviteId, 'accepted');
  }

  declineInvite(inviteId: string): Promise<void> {
    console.log('Recusando convite com ID:', inviteId);
    return this.updateInviteStatus(inviteId, 'declined');
  }
}
