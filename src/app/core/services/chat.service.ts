// chat.service.ts
import { Injectable } from '@angular/core';
import {
  getFirestore, collection, addDoc, doc, Timestamp, setDoc, CollectionReference, query, where, getDocs, deleteDoc, orderBy, limitToLast
} from 'firebase/firestore';
import { Chat } from '../interfaces/chat.interface';
import { Message } from '../interfaces/message.interface';
import { map } from 'rxjs/operators';
import { from } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private db = getFirestore();

  constructor() { }

  // Para criar uma nova conversa
  async createChat(participants: string[]): Promise<void> {
    const chat: Chat = {
      participants,
      timestamp: Timestamp.now()
    };

    try {
      await addDoc(collection(this.db, 'chats'), chat);
    } catch (error) {
      console.error("Erro ao criar chat:", error);
      throw error;
    }
  }

  // Para enviar uma mensagem em uma conversa
  async sendMessage(chatId: string, message: Message): Promise<void> {
    try {
      const chatDoc = doc(this.db, 'chats', chatId);
      const messageCollection = collection(chatDoc, 'messages') as CollectionReference<Message>;
      await addDoc(messageCollection, message);
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      throw error;
    }
  }

  getChats(userId: string) {
    const chatsRef = collection(this.db, 'chats');
    const q = query(chatsRef, where('participants', 'array-contains', userId));

    return from(getDocs(q)).pipe(
      map(querySnapshot => {
        return querySnapshot.docs.map(doc => {
          const chatData = doc.data() as Chat;
          return {
            ...chatData, // Espalha todas as propriedades de chatData
            id: doc.id, // Adiciona o id do documento Firestore
          };
        });
      })
    );
  }

  async updateChat(chatId: string, updateData: Partial<Chat>): Promise<void> {
    try {
      const chatDocRef = doc(this.db, 'chats', chatId);
      await setDoc(chatDocRef, updateData, { merge: true });
    } catch (error) {
      console.error("Erro ao atualizar chat:", error);
      throw error;
    }
  }
    async deleteChat(chatId: string): Promise < void> {
      try {
        const chatDocRef = doc(this.db, 'chats', chatId);
        await deleteDoc(chatDocRef);
      } catch(error) {
        console.error("Erro ao deletar chat:", error);
        throw error;
      }
    }

  getMessages(chatId: string, limit: number = 10) {
    const messagesRef = collection(this.db, `chats/${chatId}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limitToLast(limit));

    return from(getDocs(q)).pipe(
      map(querySnapshot => {
        return querySnapshot.docs.map(doc => doc.data() as Message);
      })
    );
  }
  
}
