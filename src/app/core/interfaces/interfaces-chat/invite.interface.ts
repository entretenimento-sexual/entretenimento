// src\app\core\interfaces\interfaces-chat\invite.interface.ts
import { Timestamp, FieldValue } from 'firebase/firestore';

export type InviteType = 'room' | 'community' | 'friend';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'canceled';

export interface Invite {
  id?: string;

  // ✅ v2 (recomendado)
  type?: InviteType;
  targetId?: string;
  targetName?: string;

  // canônico
  senderId: string;
  receiverId: string;
  status: InviteStatus;
  sentAt: Timestamp;
  expiresAt: Timestamp;

  // audit
  respondedAt?: Timestamp | FieldValue | null;
  updatedAt?: Timestamp | FieldValue;

  // legacy (opcional)
  roomId?: string;
  roomName?: string;
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
