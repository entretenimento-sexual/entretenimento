// src/app/core/services/batepapo/invite-service/invite-inbox.service.ts
// Inbox realtime de convites com cache por UID e borda serializável.
import { Injectable } from '@angular/core';
import { limit, orderBy, where } from '@angular/fire/firestore';
import { combineLatest, Observable, of, timer } from 'rxjs';
import { finalize, map, shareReplay } from 'rxjs/operators';

import {
  Invite,
  InviteInboxItem,
  InviteStatus,
  InviteType,
} from '@core/interfaces/interfaces-chat/invite.interface';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';

const INVITE_STATUSES: readonly InviteStatus[] = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'canceled',
];

const INVITE_TYPES: readonly InviteType[] = ['room', 'community', 'friend'];
const EXPIRY_REFRESH_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class InviteInboxService {
  private readonly cache = new Map<string, Observable<InviteInboxItem[]>>();

  constructor(
    private readonly read: FirestoreReadService,
    private readonly ctx: FirestoreContextService
  ) {}

  private requireUid(userId: string): string {
    const uid = String(userId ?? '').trim();
    if (!uid) throw new Error('UID ausente para consulta de convites.');
    return uid;
  }

  clearCacheForUser(userId: string | null | undefined): void {
    const uid = String(userId ?? '').trim();
    if (!uid) return;
    this.cache.delete(`invites:pending:${uid}`);
  }

  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Projeção exclusiva de convites para salas.
   *
   * O relógio reativo remove itens expirados da UI e do badge mesmo quando o
   * Firestore ainda não publicou uma alteração de status. A callable permanece
   * como autoridade final e revalida a expiração no aceite.
   */
  observeMyPendingRoomInvites(
    userId: string
  ): Observable<InviteInboxItem[]> {
    return combineLatest([
      this.observeMyPendingInvites(userId),
      timer(0, EXPIRY_REFRESH_MS),
    ]).pipe(
      map(([items]) => {
        const now = Date.now();

        return items.filter(
          (invite) =>
            invite.status === 'pending' &&
            (invite.type === 'room' ||
              (invite.type === null && !!invite.roomId)) &&
            (invite.expiresAtMs === null || invite.expiresAtMs > now)
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Inbox realtime serializável de infraestrutura.
   * Firestore Timestamp permanece na infraestrutura e vira epoch nesta borda.
   * Consumidores de produto devem preferir a projeção específica do domínio.
   */
  observeMyPendingInvites(userId: string): Observable<InviteInboxItem[]> {
    const uid = this.requireUid(userId);
    const key = `invites:pending:${uid}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    let stream$: Observable<InviteInboxItem[]>;

    stream$ = this.ctx.deferObservable$(() => {
      const constraints = [
        where('receiverId', '==', uid),
        where('status', '==', 'pending'),
        orderBy('sentAt', 'desc'),
        limit(50),
      ];

      return this.read.getDocumentsLiveSafe<Invite>('invites', constraints, {
        idField: 'id',
        requireAuth: true,
      });
    }).pipe(
      map((items) =>
        (items ?? [])
          .map((item) => this.toInboxItem(item))
          .filter((item): item is InviteInboxItem => item !== null)
      ),
      /**
       * finalize fica antes de shareReplay: o cache só é removido quando a fonte
       * compartilhada realmente perde o último subscriber (refCount = 0).
       */
      finalize(() => {
        if (this.cache.get(key) === stream$) {
          this.cache.delete(key);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.cache.set(key, stream$);
    return stream$;
  }

  observeMyPendingInvitesSafe(
    userId: string | null | undefined
  ): Observable<InviteInboxItem[]> {
    const uid = String(userId ?? '').trim();
    return uid ? this.observeMyPendingInvites(uid) : of([]);
  }

  private toInboxItem(invite: Invite): InviteInboxItem | null {
    const id = String(invite?.id ?? '').trim();
    const senderId = String(invite?.senderId ?? '').trim();
    const receiverId = String(invite?.receiverId ?? '').trim();
    const rawStatus = invite?.status;
    const status =
      rawStatus && INVITE_STATUSES.includes(rawStatus) ? rawStatus : null;

    if (!id || !senderId || !receiverId || !status) return null;

    const rawType = invite?.type;
    const type =
      rawType && INVITE_TYPES.includes(rawType) ? rawType : null;

    return {
      id,
      type,
      targetId: this.optionalString(invite?.targetId),
      targetName: this.optionalString(invite?.targetName),
      senderId,
      receiverId,
      status,
      sentAtMs: this.toEpochMs(invite?.sentAt),
      expiresAtMs: this.toEpochMs(invite?.expiresAt),
      roomId: this.optionalString(invite?.roomId),
      roomName: this.optionalString(invite?.roomName),
    };
  }

  private optionalString(value: unknown): string | null {
    return String(value ?? '').trim() || null;
  }

  private toEpochMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (!value || typeof value !== 'object') return null;

    const candidate = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof candidate.toMillis === 'function') {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) ? Math.trunc(millis) : null;
    }

    if (typeof candidate.toDate === 'function') {
      const millis = candidate.toDate().getTime();
      return Number.isFinite(millis) ? millis : null;
    }

    if (typeof candidate.seconds === 'number') {
      const nanoseconds =
        typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : 0;
      return Math.trunc(candidate.seconds * 1000 + nanoseconds / 1_000_000);
    }

    return null;
  }
}
