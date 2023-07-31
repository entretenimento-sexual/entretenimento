import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { ChatData } from '../../interfaces/chat-data.interface';

@Injectable({
  providedIn: 'root'
})
export class ChatService {

  constructor(private db: AngularFirestore) { }

  getChat(chatId: string) {
    return this.db.doc<ChatData>(`chats/${chatId}`).valueChanges();
  }

  async joinChat(chatId: string, userId: string) {
    const snapshot = await this.db.doc<ChatData>(`chats/${chatId}`).get().toPromise();

    if (snapshot?.exists) {
      const data = snapshot.data();

      if (data && data.users && data.maxUsers && data.users.length < data.maxUsers) {
        return this.db.doc(`chats/${chatId}`).update({
          users: [...data.users, userId]
        });
      } else {
        throw new Error('A sala de bate-papo está cheia ou os dados do chat estão incompletos.');
      }
    } else {
      throw new Error('A sala de bate-papo não existe.');
    }
  }

  async leaveChat(chatId: string, userId: string) {
    const snapshot = await this.db.doc<ChatData>(`chats/${chatId}`).get().toPromise();

    if (snapshot?.exists) {
      const data = snapshot.data();

      if (data && data.users && data.users.includes(userId)) {
        return this.db.doc(`chats/${chatId}`).update({
          users: data.users.filter((id: string) => id !== userId)
        });
      } else {
        throw new Error('O usuário não está na sala de bate-papo ou os dados do chat estão incompletos.');
      }
    } else {
      throw new Error('A sala de bate-papo não existe.');
    }
  }
}
