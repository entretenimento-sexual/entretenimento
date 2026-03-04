//src\app\core\utils\invite-utils.ts
export class InviteDocId {
  static room(roomId: string, receiverUid: string): string {
    return `room:${(roomId ?? '').trim()}:to:${(receiverUid ?? '').trim()}`;
  }

  static community(communityId: string, receiverUid: string): string {
    return `community:${(communityId ?? '').trim()}:to:${(receiverUid ?? '').trim()}`;
  }

  static friend(senderUid: string, receiverUid: string): string {
    return `friend:${(senderUid ?? '').trim()}:to:${(receiverUid ?? '').trim()}`;
  }
}
