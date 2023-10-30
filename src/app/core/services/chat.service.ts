// chat.service.ts
import { Injectable } from '@angular/core';
import {
  getFirestore, collection, addDoc, doc, Timestamp, setDoc, CollectionReference
} from 'firebase/firestore';
import { Chat } from '../interfaces/chat.interface';
import { Message } from '../interfaces/message.interface';

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

  // Outros métodos para recuperar mensagens, atualizar mensagens, etc.
}
