// src/app/core/services/batepapo/room-services/room-invite-flow.service.ts
// Serviço específico para fluxo de convite em salas de bate-papo.
//
// Objetivos:
// - Aceitar/recusar convites de sala (Invite.type === 'room').
// - Validar integridade do convite (destinatário, status, target da sala).
// - Garantir consistência transacional entre:
//   (1) invite
//   (2) rooms/{roomId}
//   (3) rooms/{roomId}/participants/{uid}
// - Sincronizar users/{uid}.roomIds após aceite.
//
// Regras importantes:
// - O ator autenticado vem SEMPRE de AuthSessionService.
// - O contrato do inviteId para sala é canônico:
//   room:<roomId>:to:<receiverUid>
// - Esse contrato precisa bater com rooms.rules.
//
// Observação:
// - O update em userRoomIds fica fora da transação principal.
// - Portanto, ainda é um pós-passo best-effort.
// - Se no futuro você quiser atomicidade total, o ideal é migrar o write de roomIds
//   para uma camada/repository que participe da mesma transação.

import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { UserRoomIdsService } from './user-room-ids.service';

@Injectable({ providedIn: 'root' })
export class RoomInviteFlowService {
  constructor(
    private readonly db: Firestore,
    private readonly authSession: AuthSessionService,
    private readonly userRoomIds: UserRoomIdsService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) { }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  private norm(v: string | null | undefined): string {
    return (v ?? '').trim();
  }

  /**
   * ID canônico de convite de sala.
   * Este formato precisa bater com rooms.rules (joinInviteId()).
   */
  private buildCanonicalInviteId(roomId: string, receiverUid: string): string {
    return `room:${roomId}:to:${receiverUid}`;
  }

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = err instanceof Error ? err : new Error('[RoomInviteFlow] operação falhou');
      (e as any).feature = 'room-invites';
      (e as any).original = err;
      (e as any).context = context;
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {
      // noop
    }
  }

  private fail<T>(
    userMessage: string,
    err: unknown,
    context: Record<string, unknown>
  ): Observable<T> {
    this.notify.showError(userMessage);
    this.report(err, context);
    return throwError(() => err);
  }

  /**
   * Resolve o ator autenticado a partir da sessão.
   * Evita confiar em UID vindo da UI para ações sensíveis.
   */
  private withActorUid$<T>(operation: (actorUid: string) => Observable<T>): Observable<T> {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const actorUid = this.norm(uid);

        if (!actorUid) {
          return this.fail<T>(
            'Sessão inválida para processar o convite.',
            new Error('No authenticated actor'),
            { op: 'withActorUid$' }
          );
        }

        return operation(actorUid);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Accept
  // ---------------------------------------------------------------------------

  /**
   * Aceita um convite de sala.
   *
   * Contrato importante:
   * - inviteId deve ser o docId canônico: room:<roomId>:to:<uid>
   * - se o doc existir mas o id não respeitar o padrão esperado, o fluxo falha.
   */
  acceptRoomInvite$(inviteId: string): Observable<void> {
    const iid = this.norm(inviteId);

    if (!iid) {
      return this.fail<void>(
        'Convite inválido.',
        new Error('inviteId vazio'),
        { op: 'acceptRoomInvite$', inviteId }
      );
    }

    return this.withActorUid$((actorUid) => this.acceptRoomInviteForUid$(iid, actorUid));
  }

  private acceptRoomInviteForUid$(inviteId: string, actorUid: string): Observable<void> {
    return defer(() => {
      const invRef = doc(this.db as any, 'invites', inviteId);

      return from(
        runTransaction(this.db as any, async (tx) => {
          const invSnap = await tx.get(invRef);
          if (!invSnap.exists()) throw new Error('Convite não encontrado.');

          const inv = invSnap.data() as Invite;

          if (this.norm(inv.receiverId) !== actorUid) {
            throw new Error('Você não é o destinatário deste convite.');
          }

          if ((inv.type ?? 'room') !== 'room') {
            throw new Error('Convite não é do tipo ROOM.');
          }

          if (inv.status !== 'pending') {
            throw new Error('Convite não está pendente.');
          }

          const roomId = this.norm(inv.targetId || inv.roomId);
          if (!roomId) {
            throw new Error('Convite sem targetId/roomId.');
          }

          const expectedInviteId = this.buildCanonicalInviteId(roomId, actorUid);
          if (inviteId !== expectedInviteId) {
            throw new Error(`InviteId fora do padrão canônico esperado: ${expectedInviteId}`);
          }

          const roomRef = doc(this.db as any, 'rooms', roomId);
          const participantRef = doc(this.db as any, 'rooms', roomId, 'participants', actorUid);

          const roomSnap = await tx.get(roomRef);
          if (!roomSnap.exists()) throw new Error('Sala não encontrada.');

          const roomData: any = roomSnap.data() ?? {};
          const currentParticipants: string[] = Array.isArray(roomData.participants)
            ? roomData.participants
            : [];

          const alreadyInRoom = currentParticipants.includes(actorUid);

          if (!alreadyInRoom) {
            tx.update(roomRef as any, {
              participants: [...currentParticipants, actorUid],
              lastActivity: serverTimestamp(),
            });
          }

          tx.set(
            participantRef as any,
            {
              uid: actorUid,
              joinedAt: Date.now(),
              removedAt: null,
              removed: false,
            },
            { merge: true } as any
          );

          tx.update(invRef as any, {
            status: 'accepted',
            respondedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          return roomId;
        })
      );
    }).pipe(
      switchMap((roomId: string) =>
        this.userRoomIds.addRoomId$(actorUid, roomId).pipe(
          map(() => void 0)
        )
      ),
      catchError((err) =>
        this.fail<void>(
          'Erro ao aceitar convite.',
          err,
          { op: 'acceptRoomInviteForUid$', inviteId, actorUid }
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Decline
  // ---------------------------------------------------------------------------

  /**
   * Recusa um convite de sala.
   *
   * Também valida o contrato canônico do inviteId para manter consistência
   * arquitetural com rooms.rules, mesmo que aqui não haja update no room.
   */
  declineRoomInvite$(inviteId: string): Observable<void> {
    const iid = this.norm(inviteId);

    if (!iid) {
      return this.fail<void>(
        'Convite inválido.',
        new Error('inviteId vazio'),
        { op: 'declineRoomInvite$', inviteId }
      );
    }

    return this.withActorUid$((actorUid) =>
      defer(() => {
        const invRef = doc(this.db as any, 'invites', iid);

        return from(
          runTransaction(this.db as any, async (tx) => {
            const invSnap = await tx.get(invRef);
            if (!invSnap.exists()) throw new Error('Convite não encontrado.');

            const inv = invSnap.data() as Invite;

            if (this.norm(inv.receiverId) !== actorUid) {
              throw new Error('Você não é o destinatário deste convite.');
            }

            if ((inv.type ?? 'room') !== 'room') {
              throw new Error('Convite não é do tipo ROOM.');
            }

            if (inv.status !== 'pending') {
              throw new Error('Convite não está pendente.');
            }

            const roomId = this.norm(inv.targetId || inv.roomId);
            if (!roomId) {
              throw new Error('Convite sem targetId/roomId.');
            }

            const expectedInviteId = this.buildCanonicalInviteId(roomId, actorUid);
            if (iid !== expectedInviteId) {
              throw new Error(`InviteId fora do padrão canônico esperado: ${expectedInviteId}`);
            }

            tx.update(invRef as any, {
              status: 'declined',
              respondedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          })
        ).pipe(map(() => void 0));
      }).pipe(
        catchError((err) =>
          this.fail<void>(
            'Erro ao recusar convite.',
            err,
            { op: 'declineRoomInvite$', inviteId: iid, actorUid }
          )
        )
      )
    );
  }
} // Linha 295, fim do room-invite-flow.service.ts
