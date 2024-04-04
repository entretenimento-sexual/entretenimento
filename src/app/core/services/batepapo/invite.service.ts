//src\app\core\services\batepapo\invite.service.ts
import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { Invite } from '../../interfaces/interfaces-chat/invite.interface';
import { Timestamp, addDoc, collection, serverTimestamp } from 'firebase/firestore'; // Ajuste conforme a versão do Firebase

@Injectable({
  providedIn: 'root'
})
export class InviteService {
  constructor(private firestore: AngularFirestore) { }

  async sendInvite(inviteData: Omit<Invite, 'id' | 'roomName'>, roomName: string): Promise<void> {
    const invite = {
      ...inviteData,
      roomName: roomName,
      sentAt: serverTimestamp(), // Atribuindo a data/hora do servidor
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
    };

    await addDoc(collection(this.firestore.firestore, 'invites'), invite);
  }

  getInvitesByUser(userId: string): Observable<Invite[]> {
    return this.firestore.collection<Invite>('invites', ref => ref.where('receiverId', '==', userId)).valueChanges();
  }

  async updateInviteStatus(inviteId: string, status: 'accepted' | 'declined'): Promise<void> {
    const inviteRef = this.firestore.doc(`invites/${inviteId}`);
    await inviteRef.update({ status: status });
  }

  observeInvites(userId: string): Observable<Invite[]> {
    return this.firestore.collection<Invite>('invites', ref => ref.where('receiverId', '==', userId).where('status', '==', 'pending')).valueChanges({ idField: 'id' });
  }
}
