// src/app/core/interfaces/interfaces-chat/message.interface.ts
// Não esqueça os comentários
import { Timestamp } from 'firebase/firestore';

export type DirectMessageType = 'text' | 'public_video';

export interface PublicVideoMessageReference {
  readonly kind: 'PUBLIC_VIDEO';
  readonly ownerUid: string;
  readonly videoId: string;
  readonly title: string;
}

/**
 * MANUTENÇÃO — RESTRIÇÃO FUTURA POR ASSINATURA/AUDIÊNCIA
 *
 * A referência acima nunca concede acesso ao vídeo. Quando as audiências
 * FRIENDS, SUBSCRIBERS ou PREMIUM forem ativadas, o backend deverá validar o
 * entitlement do destinatário no envio e o backend de playback deverá validar
 * novamente ao abrir. Nunca persistir URL assinada, caminho de Storage, token
 * ou snapshot financeiro dentro da mensagem.
 */
export interface Message {
  id?: string;
  content: string;
  senderId: string;
  nickname: string;
  timestamp: Timestamp;
  status?: 'sent' | 'delivered' | 'read';
  messageType?: DirectMessageType;
  publicVideoReference?: PublicVideoMessageReference;

  /**
   * Estado de exclusão lógica.
   *
   * O cliente não apaga fisicamente mensagens diretas. A Cloud Function
   * deleteDirectMessage valida autoria/participação e marca a mensagem como
   * apagada para manter a conversa consistente entre os participantes.
   */
  deleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;

  /**
   * Reações persistentes por usuário.
   *
   * Estrutura esperada:
   * reactionsByUser: {
   *   [uid]: '❤️'
   * }
   *
   * Rules limitam cada participante a alterar somente a própria chave.
   */
  reactionsByUser?: Record<string, string>;

  // ✅ compat opcional (sem quebrar o app)
  senderUid?: string;
  createdAt?: Timestamp;
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
