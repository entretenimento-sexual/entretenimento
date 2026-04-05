// src/app/core/services/batepapo/invite-service/invite-inbox.service.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
import { Injectable } from '@angular/core';
import { where, orderBy, limit } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { map, shareReplay, finalize } from 'rxjs/operators';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { Invite } from '@core/interfaces/interfaces-chat/invite.interface';

@Injectable({ providedIn: 'root' })
export class InviteInboxService {
  private readonly cache = new Map<string, Observable<Invite[]>>();

  constructor(
    private readonly read: FirestoreReadService,
    private readonly ctx: FirestoreContextService
  ) {}

  private requireUid(userId: string): string {
    const uid = (userId ?? '').trim();
    if (!uid) throw new Error('UID ausente para consulta de convites.');
    return uid;
  }

  /** Limpeza explícita para logout / troca de uid / saída da tela */
  clearCacheForUser(userId: string | null | undefined): void {
    const uid = (userId ?? '').trim();
    if (!uid) return;

    this.cache.delete(`invites:pending:${uid}`);
  }

  /** Limpeza global defensiva */
  clearAllCache(): void {
    this.cache.clear();
  }

  /** Inbox realtime: convites pendentes do usuário (filtra tipo ROOM no client p/ compat legacy) */
  observeMyPendingRoomInvites(userId: string): Observable<Invite[]> {
    return this.observeMyPendingInvites(userId).pipe(
      map((items) =>
        items.filter(
          (inv) =>
            inv.status === 'pending' &&
            (
              inv.type === 'room' ||
              (!('type' in (inv as any)) && !!(inv as any).roomId)
            )
        )
      )
    );
  }

  /**
   * Inbox realtime: TODOS os convites pendentes do usuário (base)
   *
   * Ajuste principal:
   * - constraints e stream agora nascem dentro do Injection Context
   * - isso elimina o warning do AngularFire sobre APIs chamadas fora do contexto
   */
  observeMyPendingInvites(userId: string): Observable<Invite[]> {
    const uid = this.requireUid(userId);
    const key = `invites:pending:${uid}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const stream$ = this.ctx.deferObservable$(() => {
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
      shareReplay({ bufferSize: 1, refCount: true }),
      finalize(() => this.cache.delete(key))
    );

    this.cache.set(key, stream$);
    return stream$;
  }

  /** Utilitário para telas que podem abrir sem login */
  observeMyPendingInvitesSafe(
    userId: string | null | undefined
  ): Observable<Invite[]> {
    const uid = (userId ?? '').trim();
    return uid ? this.observeMyPendingInvites(uid) : of([]);
  }
} // Linha 98