// src/app/messaging/direct-chat/models/direct-chat.models.ts
// ============================================================================
// DIRECT CHAT MODELS
//
// Modelos do eixo de chat direto 1:1.
//
// Objetivo:
// - manter compatibilidade com o estado atual
// - preparar evolução para restrições de abertura,
//   compatibilidade entre perfis e experiência visual mais rica
//
// Observação:
// - os campos novos foram adicionados sem remover os atuais
// - isso evita conflitos imediatos no restante da aplicação
// ============================================================================

import type { PublicUserIdentity } from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import type { PublicUserPreview } from 'src/app/core/domain/public-user-preview/public-user-preview.model';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

export type DirectChatId = string;

export type DirectChatAvailability =
  | 'open'
  | 'restricted'
  | 'blocked';

export type DirectChatBlockedReason =
  | 'participant-unavailable'
  | 'mutual-block'
  | 'account-restricted'
  | 'age-verification-pending'
  | 'age-verification-blocked'
  | 'preference-mismatch'
  | 'unknown';

export interface DirectChatSelection {
  chatId: DirectChatId | null;
}

export interface DirectChatListItem {
  /**
   * Identificador canônico do chat direto.
   */
  id: DirectChatId;

  /**
   * Documento bruto/compat vindo do chat legado.
   */
  chat: IChat;

  /**
   * UID do outro participante do chat 1:1.
   */
  otherParticipantUid: string | null;

  /**
   * Identidade pública sanitizada do outro participante. Este é o contrato
   * preferencial para novas superfícies de Chat.
   */
  otherParticipantIdentity?: PublicUserIdentity | null;

  /**
   * Prévia pública sanitizada derivada da mesma projeção pública usada pela
   * identidade. Não dispara leitura adicional e nunca carrega documento
   * privado de users/{uid}.
   */
  otherParticipantPreview?: PublicUserPreview | null;

  /**
   * Alias legado de otherParticipantIdentity.nickname.
   * Mantido durante a migração para não quebrar componentes existentes.
   */
  otherParticipantNickname: string | null;

  /**
   * Alias legado de otherParticipantIdentity.avatarUrl.
   * Mantido durante a migração para não quebrar componentes existentes.
   */
  otherParticipantPhotoURL?: string | null;

  /**
   * Quantidade de não lidas no chat.
   */
  unreadCount: number;

  /**
   * Preview simples da última mensagem.
   */
  lastMessagePreview?: string | null;

  /**
   * Epoch ms para ordenação confiável da lista.
   */
  lastMessageAt?: number | null;

  /**
   * Status derivado de abertura do chat.
   * Nesta fase tende a ser "open".
   */
  availability?: DirectChatAvailability;

  /**
   * Flag final para a UI saber se pode abrir.
   */
  canOpen?: boolean;

  /**
   * Motivo do bloqueio/restrição, quando existir.
   */
  blockedReason?: DirectChatBlockedReason | null;

  /**
   * Label futura de afinidade/compatibilidade.
   * Ex.: "Procura homem", "Casal compatível", etc.
   */
  compatibilityLabel?: string | null;

  /**
   * Gancho futuro para discovery/chat direto orientado por desejo/preferência.
   */
  isDesiredProfileMatch?: boolean | null;
}

export interface DirectChatListState {
  items: DirectChatListItem[];
  selectedChatId: DirectChatId | null;
  loading: boolean;

  /**
   * Campos opcionais para evolução futura sem quebrar contrato atual.
   */
  loaded?: boolean;
  errorMessage?: string | null;
}
