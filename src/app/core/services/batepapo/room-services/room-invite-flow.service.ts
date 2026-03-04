//src\app\core\services\batepapo\room-services\room-invite-flow.service.ts
// Serviço específico para fluxo de convite em salas de bate-papo
// - Foco em aceitar/recusar convites de sala (Invite.type === 'room')
// - Validações de segurança e integridade (ex: só destinatário pode aceitar/recusar, status pendente, etc.)
// -  Transações para garantir consistência (atualização de sala + invite)
// - Tratamento de erros centralizado (GlobalErrorHandlerService + ErrorNotificationService)
// - Observable-first (evita try/catch “falso” e Promises na API pública)
// Observação: este serviço é específico para o fluxo de convite de SALA. Para criação de convites, use o InviteService (que pode ser mais genérico e suportar outros tipos no futuro).
// Lembre-se de seguir a padronização de uid para usuários, o identificador canônico.
// AUTH ORCHESTRATOR SERVICE (Efeitos colaterais e ciclo de vida)
// Objetivo principal deste service:
// - Orquestrar “o que roda quando a sessão existe” (presence, watchers, keepAlive).
// - Garantir que listeners NÃO iniciem no registro e NÃO iniciem para emailVerified=false.
// - Centralizar encerramento de sessão *quando inevitável* (auth inválido).
// Regra de plataforma (conforme sua decisão):
// ✅ O usuário só deve perder a sessão (signOut) por LOGOUT voluntário,
//    EXCETO quando a própria sessão do Firebase Auth for tecnicamente inválida.
// - Em problemas de Firestore (doc missing / permission-denied / status) nós NÃO deslogamos.
//   Em vez disso: "bloqueamos" a sessão do app e redirecionamos para /register/welcome.
// Observação de arquitetura (fonte única):
// - AuthSessionService: verdade do Firebase Auth
// - CurrentUserStoreService: verdade do usuário do app (perfil/role/etc.)
// - AuthAppBlockService: verdade do "bloqueio do app" (sem logout)
// - AuthOrchestratorService: só side-effects e coordenação (não deve virar “store”)
// Não esquecer de ferramentas de debug
// Não esquecer dos comentários explicativos, para contextualizar a lógica e as decisões de design, especialmente em relação à presença online e à integração com o PresenceService. Isso ajuda a evitar confusões futuras sobre onde e como o status online deve ser controlado e lido, e reforça a ideia de que o estado online é derivado do Firestore, sem "simulações" em outros lugares (ex: Auth).'
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

@Injectable({ providedIn: 'root' })
export class RoomInviteFlowService {
  constructor(
    private db: Firestore,
    private authSession: AuthSessionService,
    private notify: ErrorNotificationService,
    private globalError: GlobalErrorHandlerService
  ) { }

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = new Error('[RoomInviteFlow] operação falhou');
      (e as any).feature = 'room-invites';
      (e as any).original = err;
      (e as any).context = context;
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch { }
  }

  acceptRoomInvite$(inviteId: string): Observable<void> {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const actorUid = (uid ?? '').trim();
        if (!actorUid) return throwError(() => new Error('Sessão inválida para aceitar convite.'));
        return this.acceptRoomInviteForUid$(inviteId, actorUid);
      })
    );
  }

  private acceptRoomInviteForUid$(inviteId: string, actorUid: string): Observable<void> {
    return defer(() => {
      const invRef = doc(this.db as any, 'invites', inviteId);

      return from(runTransaction(this.db as any, async (tx) => {
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists()) throw new Error('Convite não encontrado.');

        const inv = invSnap.data() as Invite;

        if (inv.receiverId !== actorUid) throw new Error('Você não é o destinatário deste convite.');
        if ((inv.type ?? 'room') !== 'room') throw new Error('Convite não é do tipo ROOM.');
        if (inv.status !== 'pending') throw new Error('Convite não está pendente.');

        const roomId = (inv.targetId || inv.roomId || '').trim();
        if (!roomId) throw new Error('Convite sem targetId/roomId.');

        const roomRef = doc(this.db as any, 'rooms', roomId);
        const roomSnap = await tx.get(roomRef);
        if (!roomSnap.exists()) throw new Error('Sala não encontrada.');

        const roomData: any = roomSnap.data();
        const current: string[] = Array.isArray(roomData.participants) ? roomData.participants : [];

        // idempotência básica: se já estiver na sala, só marca invite como aceito
        const alreadyIn = current.includes(actorUid);

        if (!alreadyIn) {
          const next = [...current, actorUid];

          tx.update(roomRef as any, {
            participants: next,
            lastActivity: serverTimestamp(),
          });

          // opcional (mas útil): subdoc de participant
          const participantRef = doc(this.db as any, 'rooms', roomId, 'participants', actorUid);
          tx.set(participantRef as any, {
            uid: actorUid,
            joinedAt: Date.now(),
            removed: false,
          }, { merge: true } as any);
        }

        tx.update(invRef as any, {
          status: 'accepted',
          respondedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })).pipe(map(() => void 0));
    }).pipe(
      catchError(err => {
        this.report(err, { op: 'acceptRoomInvite$', inviteId });
        this.notify.showError('Erro ao aceitar convite.');
        return throwError(() => err);
      })
    );
  }

  declineRoomInvite$(inviteId: string): Observable<void> {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const actorUid = (uid ?? '').trim();
        if (!actorUid) return throwError(() => new Error('Sessão inválida para recusar convite.'));

        return defer(() =>
          from(runTransaction(this.db as any, async (tx) => {
            const invRef = doc(this.db as any, 'invites', inviteId);
            const invSnap = await tx.get(invRef);
            if (!invSnap.exists()) throw new Error('Convite não encontrado.');

            const inv = invSnap.data() as Invite;

            if (inv.receiverId !== actorUid) throw new Error('Você não é o destinatário deste convite.');
            if (inv.status !== 'pending') throw new Error('Convite não está pendente.');

            tx.update(invRef as any, {
              status: 'declined',
              respondedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }))
        ).pipe(map(() => void 0));
      }),
      catchError(err => {
        this.report(err, { op: 'declineRoomInvite$', inviteId });
        this.notify.showError('Erro ao recusar convite.');
        return throwError(() => err);
      })
    );
  }
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
// AUTH ORCHESTRATOR SERVICE (Efeitos colaterais e ciclo de vida)
//
// Objetivo principal deste service:
// - Orquestrar “o que roda quando a sessão existe” (presence, watchers, keepAlive).
// - Garantir que listeners NÃO iniciem no registro e NÃO iniciem para emailVerified=false.
// - Centralizar encerramento de sessão *quando inevitável* (auth inválido).
//
// Regra de plataforma (conforme sua decisão):
// ✅ O usuário só deve perder a sessão (signOut) por LOGOUT voluntário,
//    EXCETO quando a própria sessão do Firebase Auth for tecnicamente inválida.
// - Em problemas de Firestore (doc missing / permission-denied / status) nós NÃO deslogamos.
//   Em vez disso: "bloqueamos" a sessão do app e redirecionamos para /register/welcome.
//
// Observação de arquitetura (fonte única):
// - AuthSessionService: verdade do Firebase Auth
// - CurrentUserStoreService: verdade do usuário do app (perfil/role/etc.)
// - AuthAppBlockService: verdade do "bloqueio do app" (sem logout)
// - AuthOrchestratorService: só side-effects e coordenação (não deve virar “store”)
