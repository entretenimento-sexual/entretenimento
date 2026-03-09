// src/app/core/services/batepapo/rooms/room-participants.service.ts
// Serviço para gerenciar participantes de salas de bate-papo usando Firestore.
//
// Objetivos deste service:
// - Gerenciar leitura realtime dos participantes de uma sala.
// - Aceitar convite e ingressar na sala com consistência transacional.
// - Adicionar/remover participantes mantendo coerência entre:
//   (1) rooms/{roomId}.participants
//   (2) rooms/{roomId}/participants/{userId}
//   (3) users/{userId}.roomIds
//
// Decisões importantes:
// - Observable-first na API pública.
// - Métodos Promise mantidos apenas por compatibilidade.
// - Ator autenticado sempre derivado de AuthSessionService em fluxos sensíveis.
// - Tratamento de erro centralizado em GlobalErrorHandlerService + ErrorNotificationService.
// - Operações de membership do room (add/remove) usam transação para reduzir risco de estado parcial.
//
// Observação:
// - Neste service, o subdoc rooms/{roomId}/participants/{userId} é um índice auxiliar.
// - A fonte de verdade principal da participação continua sendo rooms/{roomId}.participants.
//
// Não esquecer comentários explicativos para facilitar manutenção futura.

import { Injectable, NgZone } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
} from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';
import {
  Observable,
  defer,
  from,
  map,
  catchError,
  firstValueFrom,
  switchMap,
  of,
  throwError,
  take,
} from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// ✅ centralização de erros / UI
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

// ✅ vínculo roomIds do usuário
import { UserRoomIdsService } from './user-room-ids.service';

// ✅ fonte de verdade do ator autenticado
import { AuthSessionService } from '../../autentication/auth/auth-session.service';

type InviteStatus = 'pending' | 'accepted' | 'rejected' | 'declined';

type RoomParticipantDoc = {
  uid: string;
  joinedAt?: number | null;
  removedAt?: number | null;
  removed?: boolean;
};

@Injectable({ providedIn: 'root' })
export class RoomParticipantsService {
  constructor(
    private readonly db: Firestore,
    private readonly zone: NgZone,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly userRoomIds: UserRoomIdsService,
    private readonly authSession: AuthSessionService
  ) { }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  /**
   * Normaliza strings de entrada.
   * Evita espaços laterais e padroniza argumentos vindos da UI/rotas.
   */
  private norm(v: string | null | undefined): string {
    return (v ?? '').trim();
  }

  /**
   * Encapsula erro de domínio do service:
   * - mostra feedback ao usuário
   * - roteia contexto para o handler global
   * - retorna throwError preservando o erro original
   */
  private fail<T>(
    userMessage: string,
    err: unknown,
    context?: Record<string, unknown>
  ): Observable<T> {
    this.notify.showError(userMessage);

    try {
      const e = err instanceof Error ? err : new Error(userMessage);
      (e as any).original = err;
      (e as any).context = {
        scope: 'RoomParticipantsService',
        ...(context ?? {})
      };
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {
      // noop
    }

    return throwError(() => err);
  }

  /**
   * Roteia erro "silencioso" para o handler global.
   * Útil para fluxos passivos/realtime, em que o foco é não duplicar muito feedback.
   */
  private reportSilent(err: unknown, context?: Record<string, unknown>): void {
    try {
      const e = err instanceof Error ? err : new Error('[RoomParticipantsService] stream error');
      (e as any).original = err;
      (e as any).context = {
        scope: 'RoomParticipantsService',
        ...(context ?? {})
      };
      (e as any).silent = true;
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {
      // noop
    }
  }

  /**
   * Resolve o UID do ator autenticado a partir da sessão.
   * Esse helper evita confiar em userId externo para ações sensíveis.
   */
  private withActorUid$<T>(operation: (actorUid: string) => Observable<T>): Observable<T> {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const actorUid = this.norm(uid);
        if (!actorUid) {
          return this.fail<T>(
            'Sessão inválida para gerenciar participantes.',
            new Error('No authenticated actor'),
            { op: 'withActorUid$' }
          );
        }

        return operation(actorUid);
      })
    );
  }

  /**
   * Mutação transacional da participação de um usuário em uma sala.
   *
   * O que este helper faz:
   * - lê rooms/{roomId}
   * - valida existência
   * - se add:
   *    - garante targetUid em participants
   *    - marca subdoc como ativo
   * - se remove:
   *    - remove targetUid de participants
   *    - marca subdoc como removido
   *
   * Importante:
   * - Aqui a transação cobre apenas o room root doc + subdoc de participant.
   * - O vínculo users/{uid}.roomIds continua fora da transação, mas só roda se a TX principal tiver sucesso.
   */
  private mutateParticipantMembership$(
    actorUid: string,
    targetUid: string,
    roomId: string,
    mode: 'add' | 'remove'
  ): Observable<void> {
    const uid = this.norm(targetUid);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para alterar participante.',
        new Error('Invalid args'),
        { op: 'mutateParticipantMembership$', actorUid, targetUid, roomId, mode }
      );
    }

    const roomRef = doc(this.db, 'rooms', rid);
    const participantRef = doc(this.db, 'rooms', rid, 'participants', uid);

    return defer(() =>
      from(
        runTransaction(this.db, async (tx) => {
          const roomSnap = await tx.get(roomRef);

          if (!roomSnap.exists()) {
            throw new Error('Sala não encontrada.');
          }

          const roomData = roomSnap.data() as any;
          const createdBy = this.norm(roomData?.createdBy);
          const currentParticipants: string[] = Array.isArray(roomData?.participants)
            ? roomData.participants
            : [];

          // Regra de integridade no client:
          // - o próprio usuário pode agir sobre seu doc
          // - o owner da sala também pode gerenciar terceiros
          const actorCanManage = actorUid === uid || createdBy === actorUid;
          if (!actorCanManage) {
            throw new Error('Ação não autorizada para este participante.');
          }

          const alreadyInRoom = currentParticipants.includes(uid);

          if (mode === 'add') {
            if (!alreadyInRoom) {
              tx.update(roomRef, {
                participants: [...currentParticipants, uid],
              } as any);
            }

            const participantData: RoomParticipantDoc = {
              uid,
              joinedAt: Date.now(),
              removedAt: null,
              removed: false,
            };

            tx.set(participantRef, participantData as any, { merge: true });
            return;
          }

          // mode === 'remove'
          if (alreadyInRoom) {
            tx.update(roomRef, {
              participants: currentParticipants.filter((participantUid) => participantUid !== uid),
            } as any);
          }

          const participantData: RoomParticipantDoc = {
            uid,
            removedAt: Date.now(),
            removed: true,
          };

          tx.set(participantRef, participantData as any, { merge: true });
        })
      )
    ).pipe(
      map(() => void 0),
      catchError((err) =>
        this.fail<void>(
          mode === 'add'
            ? 'Erro ao adicionar participante na sala.'
            : 'Erro ao remover participante da sala.',
          err,
          { op: 'mutateParticipantMembership$', actorUid, targetUid: uid, roomId: rid, mode }
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Realtime: participantes
  // ---------------------------------------------------------------------------

  /**
   * Obtém os participantes de uma sala em tempo real.
   *
   * Observação:
   * - Aqui lemos a subcoleção rooms/{roomId}/participants.
   * - O array participants do doc raiz da sala continua sendo a fonte principal de membership.
   */
  getParticipants(roomId: string): Observable<any[]> {
    const rid = this.norm(roomId);
    if (!rid) return of([]);

    const participantsRef = collection(this.db, `rooms/${rid}/participants`);

    return new Observable<any[]>((observer) => {
      const unsubscribe = onSnapshot(
        participantsRef,
        (snapshot) => {
          this.zone.run(() => {
            const participants = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));
            observer.next(participants);
          });
        },
        (error) => {
          this.zone.run(() => {
            this.reportSilent(error, { op: 'getParticipants', roomId: rid });
            this.notify.showError('Erro ao carregar participantes.');
            observer.error(error);
          });
        }
      );

      return () => unsubscribe();
    });
  }

  // ---------------------------------------------------------------------------
  // Convites / Join
  // ---------------------------------------------------------------------------

  /**
   * Aceita convite e adiciona usuário à sala (Promise).
   * Mantém assinatura original por compatibilidade.
   */
  async acceptInviteAndJoinRoom(inviteId: string, roomId: string, userId: string): Promise<void> {
    await firstValueFrom(this.acceptInvite(roomId, inviteId, userId));
  }

  /**
   * Aceita um convite e adiciona o usuário autenticado à sala.
   *
   * O que este método atualiza:
   * - rooms/{roomId}.participants
   * - rooms/{roomId}/participants/{actorUid}
   * - invites/{inviteId} -> accepted + respondedAt + updatedAt
   * - users/{actorUid}.roomIds (via UserRoomIdsService)
   *
   * Importante:
   * - o userId recebido é mantido por compatibilidade, mas NÃO é mais a fonte de verdade do ator;
   * - a identidade do ator vem da sessão (AuthSessionService);
   * - se userId vier preenchido e não bater com a sessão, o fluxo falha por integridade.
   */
  acceptInvite(roomId: string, inviteId: string, userId: string): Observable<void> {
    const rid = this.norm(roomId);
    const iid = this.norm(inviteId);
    const requestedUid = this.norm(userId);

    if (!rid || !iid) {
      return this.fail<void>(
        'Dados inválidos para aceitar convite.',
        new Error('Invalid args'),
        { op: 'acceptInvite', roomId, inviteId, userId }
      );
    }

    return this.withActorUid$((actorUid) => {
      if (requestedUid && requestedUid !== actorUid) {
        return this.fail<void>(
          'Sessão incompatível com o convite informado.',
          new Error('Actor UID mismatch'),
          { op: 'acceptInvite', requestedUid, actorUid, roomId: rid, inviteId: iid }
        );
      }

      const roomRef = doc(this.db, 'rooms', rid);
      const inviteRef = doc(this.db, 'invites', iid);
      const participantRef = doc(this.db, 'rooms', rid, 'participants', actorUid);

      const tx$ = defer(() =>
        from(
          runTransaction(this.db, async (tx) => {
            const [roomSnap, inviteSnap] = await Promise.all([
              tx.get(roomRef),
              tx.get(inviteRef),
            ]);

            if (!inviteSnap.exists()) throw new Error('Convite não encontrado.');
            if (!roomSnap.exists()) throw new Error('Sala não encontrada.');

            const invite = inviteSnap.data() as any;
            const status = (invite?.status ?? 'pending') as InviteStatus;

            const inviteReceiverId = this.norm(invite?.receiverId);
            if (inviteReceiverId !== actorUid) {
              throw new Error('O usuário autenticado não é o destinatário do convite.');
            }

            const inviteRoomId = this.norm(invite?.targetId || invite?.roomId);
            if (!inviteRoomId) {
              throw new Error('Convite sem roomId/targetId.');
            }

            if (inviteRoomId !== rid) {
              throw new Error('Convite não corresponde à sala informada.');
            }

            const roomData = roomSnap.data() as any;
            const participants: string[] = Array.isArray(roomData?.participants)
              ? roomData.participants
              : [];

            if (!participants.includes(actorUid)) {
              tx.update(roomRef, {
                participants: [...participants, actorUid],
              } as any);
            }

            tx.set(
              participantRef,
              {
                uid: actorUid,
                joinedAt: Date.now(),
                removedAt: null,
                removed: false,
              } as any,
              { merge: true }
            );

            if (status !== 'accepted') {
              tx.update(inviteRef, {
                status: 'accepted',
                respondedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              } as any);
            }
          })
        )
      ).pipe(map(() => void 0));

      return tx$.pipe(
        switchMap(() => this.userRoomIds.addRoomId$(actorUid, rid)),
        map(() => void 0),
        catchError((err) =>
          this.fail<void>(
            'Erro ao aceitar convite.',
            err,
            { op: 'acceptInvite', actorUid, roomId: rid, inviteId: iid }
          )
        )
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Add/Remove participante
  // ---------------------------------------------------------------------------

  /**
   * Adiciona usuário à sala (Promise).
   * Mantido por compatibilidade com chamadas legadas.
   */
  async addUserToRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.addUserToRoom$(userId, roomId));
  }

  /**
   * Remove usuário da sala (Promise).
   * Mantido por compatibilidade com chamadas legadas.
   */
  async removeUserFromRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.removeUserFromRoom$(userId, roomId));
  }

  /**
   * Versão reativa para adicionar usuário à sala.
   *
   * Fluxo:
   * - transação room + participant subdoc
   * - depois sincroniza users/{uid}.roomIds
   */
  addUserToRoom$(userId: string, roomId: string): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para adicionar participante.',
        new Error('Invalid args'),
        { op: 'addUserToRoom$', userId, roomId }
      );
    }

    return this.withActorUid$((actorUid) =>
      this.mutateParticipantMembership$(actorUid, uid, rid, 'add').pipe(
        switchMap(() => this.userRoomIds.addRoomId$(uid, rid)),
        map(() => void 0),
        catchError((err) =>
          this.fail<void>(
            'Erro ao adicionar participante na sala.',
            err,
            { op: 'addUserToRoom$', actorUid, targetUid: uid, roomId: rid }
          )
        )
      )
    );
  }

  /**
   * Versão reativa para remover usuário da sala.
   *
   * Fluxo:
   * - transação room + participant subdoc
   * - depois sincroniza users/{uid}.roomIds
   */
  removeUserFromRoom$(userId: string, roomId: string): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>(
        'Dados inválidos para remover participante.',
        new Error('Invalid args'),
        { op: 'removeUserFromRoom$', userId, roomId }
      );
    }

    return this.withActorUid$((actorUid) =>
      this.mutateParticipantMembership$(actorUid, uid, rid, 'remove').pipe(
        switchMap(() => this.userRoomIds.removeRoomId$(uid, rid)),
        map(() => void 0),
        catchError((err) =>
          this.fail<void>(
            'Erro ao remover participante da sala.',
            err,
            { op: 'removeUserFromRoom$', actorUid, targetUid: uid, roomId: rid }
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Criador da sala
  // ---------------------------------------------------------------------------

  /**
   * Obtém informações do criador de uma sala (one-shot).
   */
  getRoomCreator(roomId: string): Observable<IUserDados> {
    const rid = this.norm(roomId);
    if (!rid) {
      return this.fail<IUserDados>(
        'Sala não encontrada.',
        new Error('roomId vazio'),
        { op: 'getRoomCreator', roomId }
      );
    }

    const roomRef = doc(this.db, 'rooms', rid);

    return defer(() => from(getDoc(roomRef))).pipe(
      switchMap((roomSnap) => {
        if (!roomSnap.exists()) {
          return this.fail<IUserDados>(
            'Sala não encontrada.',
            new Error('Sala não existe'),
            { op: 'getRoomCreator', roomId: rid }
          );
        }

        const creatorId = this.norm((roomSnap.data() as any)?.createdBy);
        if (!creatorId) {
          return this.fail<IUserDados>(
            'Criador da sala não encontrado.',
            new Error('createdBy ausente'),
            { op: 'getRoomCreator', roomId: rid }
          );
        }

        const userRef = doc(this.db, 'users', creatorId);

        return from(getDoc(userRef)).pipe(
          map((userSnap) => {
            if (!userSnap.exists()) {
              throw new Error('Criador da sala não encontrado.');
            }

            return {
              uid: userSnap.id,
              ...(userSnap.data() as any),
            } as IUserDados;
          })
        );
      }),
      catchError((err) =>
        this.fail<IUserDados>(
          'Erro ao buscar criador.',
          err,
          { op: 'getRoomCreator', roomId: rid }
        )
      )
    );
  }
} // Linha 592, fim do room-participants.service.ts
