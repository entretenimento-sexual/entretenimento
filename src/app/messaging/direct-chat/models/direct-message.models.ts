// src/app/messaging/direct-chat/models/direct-message.models.ts
// ============================================================================
// DIRECT MESSAGE MODELS
//
// Modelos do eixo de thread/mensagens diretas 1:1.
//
// Objetivo:
// - manter compatibilidade com Message atual
// - preparar evolução para estado da thread, gating e UX mais rica
// ============================================================================

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { DirectChatBlockedReason } from './direct-chat.models';

export type DirectMessageId = string;

export interface DirectThreadState {
  chatId: string | null;
  messages: Message[];
  loading: boolean;

  /**
   * Flags de UX/gating para a thread.
   */
  canSend?: boolean;
  canDeleteOwnMessages?: boolean;
  blockedReason?: DirectChatBlockedReason | null;

  /**
   * Campos opcionais de estado.
   */
  loaded?: boolean;
  errorMessage?: string | null;
}

export interface SendDirectMessagePayload {
  chatId: string;
  content: string;
}

export interface MarkDirectMessagesReadPayload {
  chatId: string;
  messageIds: string[];
}
