import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { deleteField, doc, FieldPath, updateDoc } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class ChatReactionWriteService {
  constructor(private readonly firestore: Firestore) {}

  write(chatId: string, messageId: string, uid: string, emoji: string | null): Promise<void> {
    const messageRef = doc(this.firestore, `chats/${chatId}/messages/${messageId}`);
    return updateDoc(messageRef, new FieldPath('reactionsByUser', uid), emoji ?? deleteField());
  }
}
