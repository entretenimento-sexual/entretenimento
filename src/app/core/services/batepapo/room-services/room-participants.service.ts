// src/app/core/services/batepapo/rooms/room-participants.service.ts
import { Injectable, NgZone } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from '@angular/fire/firestore';
import { Observable, defer, from, map, catchError, firstValueFrom, switchMap, of, throwError } from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// ✅ centralização de erros / UI
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

// ✅ service de vínculo do usuário com salas (roomIds)
import { UserRoomIdsService } from './user-room-ids.service';

type InviteStatus = 'pending' | 'accepted' | 'rejected';

@Injectable({ providedIn: 'root' })
export class RoomParticipantsService {
  constructor(
    private readonly db: Firestore,
    private readonly zone: NgZone,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly userRoomIds: UserRoomIdsService
  ) { }

  // -------------------------
  // Utils
  // -------------------------

  private norm(v: string): string {
    return (v ?? '').trim();
  }

  private fail<T>(userMessage: string, err: any): Observable<T> {
    // feedback ao usuário (toast)
    this.notify.showError(userMessage);

    // log/observabilidade central
    try {
      const e = err instanceof Error ? err : new Error(userMessage);
      (e as any).original = err;
      (e as any).context = { scope: 'RoomParticipantsService' };
      this.globalError.handleError(e);
    } catch {
      // ignore
    }

    return throwError(() => err);
  }

  // -------------------------
  // Realtime: participantes
  // -------------------------

  /**
   * Obtém os participantes de uma sala (Realtime).
   * Observação: aqui lemos a subcoleção `rooms/{roomId}/participants`.
   * (o array `participants` no doc da sala pode existir para checks rápidos/permissões)
   */
  getParticipants(roomId: string): Observable<any[]> {
    const rid = this.norm(roomId);
    if (!rid) return of([]);

    const participantsRef = collection(this.db, `rooms/${rid}/participants`);

    return new Observable<any[]>((observer) => {
      const unsubscribe = onSnapshot(
        participantsRef,
        (snapshot) => {
          // garante CD/UX em Angular, mesmo se callback vier fora da zone
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
            this.notify.showError('Erro ao carregar participantes.');
            try {
              this.globalError.handleError(error);
            } catch {
              // ignore
            }
            observer.error(error);
          });
        }
      );

      return () => unsubscribe();
    });
  }

  // -------------------------
  // Convites / Join
  // -------------------------

  /**
   * Aceita convite e adiciona usuário à sala (Promise).
   * Mantém assinatura original, mas internamente usa o fluxo reativo.
   */
  async acceptInviteAndJoinRoom(inviteId: string, roomId: string, userId: string): Promise<void> {
    await firstValueFrom(this.acceptInvite(roomId, inviteId, userId));
  }

  /**
   * Aceita um convite e adiciona o usuário à sala (Observable).
   *
   * O que é atualizado:
   * - rooms/{roomId}.participants  (array)
   * - rooms/{roomId}/participants/{userId} (doc mínimo do participante)
   * - invites/{inviteId}.status = accepted
   * - users/{userId}.roomIds recebe roomId (via UserRoomIdsService)
   *
   * Observação: a transação mantém consistência entre sala + convite + doc participante.
   * O vínculo roomIds é feito após (também reativo); caso falhe, você ainda tem o usuário na sala,
   * mas a lista "Minhas salas" pode precisar de reparo (e o erro é notificado).
   */
  acceptInvite(roomId: string, inviteId: string, userId: string): Observable<void> {
    const rid = this.norm(roomId);
    const iid = this.norm(inviteId);
    const uid = this.norm(userId);

    if (!rid || !iid || !uid) {
      return this.fail<void>('Dados inválidos para aceitar convite.', new Error('Invalid args'));
    }

    const roomRef = doc(this.db, 'rooms', rid);
    const inviteRef = doc(this.db, 'invites', iid);
    const participantRef = doc(this.db, 'rooms', rid, 'participants', uid);

    // 1) transação: sala + convite + doc participante
    const tx$ = defer(() =>
      from(
        runTransaction(this.db, async (tx) => {
          const [roomSnap, inviteSnap] = await Promise.all([tx.get(roomRef), tx.get(inviteRef)]);

          if (!inviteSnap.exists()) throw new Error('Convite não encontrado.');
          if (!roomSnap.exists()) throw new Error('Sala não encontrada.');

          const invite = inviteSnap.data() as any;
          const status = (invite?.status ?? 'pending') as InviteStatus;

          // idempotência: se já aceito, não quebra o fluxo
          if (status !== 'accepted') {
            tx.update(inviteRef, { status: 'accepted' } as any);
          }

          const roomData = roomSnap.data() as any;
          const participants: string[] = Array.isArray(roomData?.participants) ? roomData.participants : [];

          if (!participants.includes(uid)) {
            tx.update(roomRef, { participants: [...participants, uid] } as any);
          }

          // doc mínimo de participante (serve para UI, auditoria, etc.)
          tx.set(
            participantRef,
            {
              uid,
              joinedAt: Date.now(), // simples e barato; se quiser, pode trocar por serverTimestamp()
            } as any,
            { merge: true }
          );
        })
      )
    ).pipe(map(() => void 0));

    // 2) pós-tx: vincula roomId no usuário (roomIds)
    return tx$.pipe(
      switchMap(() => this.userRoomIds.addRoomId$(uid, rid)),
      map(() => void 0),
      catchError((err) => this.fail<void>('Erro ao aceitar convite.', err))
    );
  }

  // -------------------------
  // Add/Remove participante
  // -------------------------

  /**
   * Adiciona usuário à sala (Promise) — mantém nomenclatura original.
   * Internamente usa Observable para manter reatividade e padronização.
   */
  async addUserToRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.addUserToRoom$(userId, roomId));
  }

  /**
   * Remove usuário da sala (Promise) — mantém nomenclatura original.
   */
  async removeUserFromRoom(userId: string, roomId: string): Promise<void> {
    await firstValueFrom(this.removeUserFromRoom$(userId, roomId));
  }

  /**
   * Versão reativa para adicionar usuário.
   * Atualiza:
   * - rooms/{roomId}.participants (arrayUnion)
   * - rooms/{roomId}/participants/{userId} (merge)
   * - users/{userId}.roomIds (addRoomId$)
   */
  addUserToRoom$(userId: string, roomId: string): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>('Dados inválidos para adicionar participante.', new Error('Invalid args'));
    }

    const roomRef = doc(this.db, 'rooms', rid);
    const participantRef = doc(this.db, 'rooms', rid, 'participants', uid);

    return defer(() => from(updateDoc(roomRef, { participants: arrayUnion(uid) } as any))).pipe(
      switchMap(() =>
        from(
          setDoc(
            participantRef,
            {
              uid,
              joinedAt: Date.now(),
            } as any,
            { merge: true }
          )
        )
      ),
      switchMap(() => this.userRoomIds.addRoomId$(uid, rid)),
      map(() => void 0),
      catchError((err) => this.fail<void>('Erro ao adicionar participante na sala.', err))
    );
  }

  /**
   * Versão reativa para remover usuário.
   * Atualiza:
   * - rooms/{roomId}.participants (arrayRemove)
   * - rooms/{roomId}/participants/{userId} (marca como removido — evita delete e facilita auditoria)
   * - users/{userId}.roomIds (removeRoomId$)
   */
  removeUserFromRoom$(userId: string, roomId: string): Observable<void> {
    const uid = this.norm(userId);
    const rid = this.norm(roomId);

    if (!uid || !rid) {
      return this.fail<void>('Dados inválidos para remover participante.', new Error('Invalid args'));
    }

    const roomRef = doc(this.db, 'rooms', rid);
    const participantRef = doc(this.db, 'rooms', rid, 'participants', uid);

    return defer(() => from(updateDoc(roomRef, { participants: arrayRemove(uid) } as any))).pipe(
      // em vez de deletar, marcamos (padrão “audit-friendly”)
      switchMap(() =>
        from(
          setDoc(
            participantRef,
            {
              uid,
              removedAt: Date.now(),
              removed: true,
            } as any,
            { merge: true }
          )
        )
      ),
      switchMap(() => this.userRoomIds.removeRoomId$(uid, rid)),
      map(() => void 0),
      catchError((err) => this.fail<void>('Erro ao remover participante da sala.', err))
    );
  }

  // -------------------------
  // Criador da sala
  // -------------------------

  /**
   * Obtém informações do criador de uma sala (One-shot).
   */
  getRoomCreator(roomId: string): Observable<IUserDados> {
    const rid = this.norm(roomId);
    if (!rid) return this.fail<IUserDados>('Sala não encontrada.', new Error('roomId vazio'));

    const roomRef = doc(this.db, 'rooms', rid);

    return defer(() => from(getDoc(roomRef))).pipe(
      switchMap((roomSnap) => {
        if (!roomSnap.exists()) {
          return this.fail<IUserDados>('Sala não encontrada.', new Error('Sala não existe'));
        }

        const creatorId = (roomSnap.data() as any)?.createdBy as string | undefined;
        if (!creatorId) {
          return this.fail<IUserDados>('Criador da sala não encontrado.', new Error('createdBy ausente'));
        }

        const userRef = doc(this.db, 'users', creatorId);
        return from(getDoc(userRef)).pipe(
          map((userSnap) => {
            if (!userSnap.exists()) {
              throw new Error('Criador da sala não encontrado.');
            }
            return { uid: userSnap.id, ...(userSnap.data() as any) } as IUserDados;
          })
        );
      }),
      catchError((err) => this.fail<IUserDados>('Erro ao buscar criador.', err))
    );
  }
}
