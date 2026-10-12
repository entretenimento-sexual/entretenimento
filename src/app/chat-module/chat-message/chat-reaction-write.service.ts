import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { deleteField, doc, FieldPath, updateDoc } from 'firebase/firestore';

export function directReactionFieldUpdate(uid: string, emoji: string | null) {
  return {
    field: new FieldPath('reactionsByUser', uid),
    value: emoji ?? deleteField(),
  };
}

@Injectable({ providedIn: 'root' })
export class ChatReactionWriteService {
  constructor(private readonly firestore: Firestore) {}

  write(chatId: string, messageId: string, uid: string, emoji: string | null): Promise<void> {
    const messageRef = doc(this.firestore, `chats/${chatId}/messages/${messageId}`);
    const { field, value } = directReactionFieldUpdate(uid, emoji);
    return updateDoc(messageRef, field, value);
  }
}
