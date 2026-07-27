// src/app/core/services/batepapo/invite-service/invite-inbox.service.spec.ts
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { FirestoreReadService } from 'src/app/core/services/data-handling/firestore/core/firestore-read.service';
import { InviteInboxService } from './invite-inbox.service';

describe('InviteInboxService serializable boundary', () => {
  it('converte Timestamp-like para epoch antes de expor o inbox', async () => {
    const rawInvite = {
      id: 'room:room-1:to:user-a',
      type: 'room',
      targetId: 'room-1',
      targetName: 'Sala 1',
      senderId: 'sender-a',
      receiverId: 'user-a',
      status: 'pending',
      sentAt: { toMillis: () => 1234 },
      expiresAt: { seconds: 5, nanoseconds: 250_000_000 },
    } as unknown as Invite;

    const read = {
      getDocumentsLiveSafe: () => of([rawInvite]),
    } as unknown as FirestoreReadService;

    const ctx = {
      deferObservable$: <T>(factory: () => T): T => factory(),
    } as unknown as FirestoreContextService;

    const service = new InviteInboxService(read, ctx);
    const items = await firstValueFrom(
      service.observeMyPendingInvites('user-a')
    );

    expect(items).toEqual([
      {
        id: 'room:room-1:to:user-a',
        type: 'room',
        targetId: 'room-1',
        targetName: 'Sala 1',
        senderId: 'sender-a',
        receiverId: 'user-a',
        status: 'pending',
        sentAtMs: 1234,
        expiresAtMs: 5250,
        roomId: null,
        roomName: null,
      },
    ]);
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
  });

  it('descarta documento inválido em vez de contaminar o Store', async () => {
    const read = {
      getDocumentsLiveSafe: () =>
        of([
          {
            senderId: 'sender-a',
            receiverId: 'user-a',
            status: 'pending',
          } as Invite,
        ]),
    } as unknown as FirestoreReadService;

    const ctx = {
      deferObservable$: <T>(factory: () => T): T => factory(),
    } as unknown as FirestoreContextService;

    const service = new InviteInboxService(read, ctx);

    await expect(
      firstValueFrom(service.observeMyPendingInvites('user-a'))
    ).resolves.toEqual([]);
  });
});
