import { Timestamp } from 'firebase/firestore';
import type { FriendsPageCursor } from '../../../../interfaces/friendship/friend.interface';

/** Preserve the raw ordering fields even if a public profile is filtered out. */
export function createFriendsPageCursor(documentId: string, timestamp: Timestamp | undefined): FriendsPageCursor {
  if (!documentId || !timestamp || !Number.isInteger(timestamp.seconds) || !Number.isInteger(timestamp.nanoseconds)) {
    throw new Error('Cursor de amizade sem timestamp canônico ou identificador.');
  }
  return { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds, documentId };
}

export function friendsPageStartAfter(cursor: FriendsPageCursor): [Timestamp, string] {
  if (!cursor.documentId) throw new Error('Cursor de amizade sem identificador.');
  return [new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.documentId];
}
