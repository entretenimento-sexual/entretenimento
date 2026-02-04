// src/app/store/reducers/reducers.chat/chat.reducer.ts
// Reducer do domínio Chat.
// - Mantém estado previsível (sem side-effects).
// - Faz merge/dedupe de mensagens (evita duplicação entre optimistic + realtime).
// - Reordena chats por “última atividade” (padrão de plataformas grandes).
// Não esquecer os comentários.

import { createReducer, on } from '@ngrx/store';

import * as ChatActions from '../../actions/actions.chat/chat.actions';

import { ChatState, initialChatState } from '../../states/states.chat/chat.state';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

// =============================================================================
// Helpers puros (reducer-safe) para tempo, dedupe e ordenação
// =============================================================================

type AnyMsg = Message & { id?: string };

function toMillisSafe(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'number') return ts;
  return 0;
}

function chatActivityMillis(chat: IChat): number {
  // “Última atividade” = timestamp do lastMessage se existir; senão timestamp do chat
  const last = (chat as any)?.lastMessage?.timestamp;
  const base = (chat as any)?.timestamp;
  return Math.max(toMillisSafe(last), toMillisSafe(base));
}

function chatKey(c: IChat): string {
  // Preferência: id do Firestore
  if (c?.id) return `id:${c.id}`;

  // Fallback: participantsKey (se existir) ou combinação determinística
  const pk = (c as any)?.participantsKey;
  if (pk) return `pk:${pk}`;

  const parts = Array.isArray(c?.participants) ? [...c.participants].sort().join('_') : '';
  return `p:${parts}`;
}

function upsertChats(existing: IChat[], incoming: IChat[]): IChat[] {
  const map = new Map<string, IChat>();

  for (const c of existing ?? []) {
    map.set(chatKey(c), c);
  }

  for (const c of incoming ?? []) {
    const k = chatKey(c);
    const prev = map.get(k);

    // Merge superficial para preservar campos locais (ex.: otherParticipantDetails)
    map.set(k, prev ? ({ ...prev, ...c } as IChat) : c);
  }

  const out = Array.from(map.values());

  // Ordena por atividade desc (mais recente em cima)
  out.sort((a, b) => chatActivityMillis(b) - chatActivityMillis(a));
  return out;
}

function patchChat(existing: IChat[], chatId: string, patch: Partial<IChat>): IChat[] {
  const id = (chatId ?? '').toString().trim();
  if (!id) return existing ?? [];

  let changed = false;

  const out = (existing ?? []).map(c => {
    if ((c as any)?.id !== id) return c;
    changed = true;
    return { ...c, ...patch } as IChat;
  });

  // Se não achou, não inventa chat novo aqui (evita estado “fantasma”)
  if (!changed) return existing ?? [];

  // Reordena após patch (lastMessage/timestamp pode mudar)
  out.sort((a, b) => chatActivityMillis(b) - chatActivityMillis(a));
  return out;
}

function removeChat(existing: IChat[], chatId: string): IChat[] {
  const id = (chatId ?? '').toString().trim();
  if (!id) return existing ?? [];
  return (existing ?? []).filter(c => (c as any)?.id !== id);
}

// =============================================================================
// Helpers de mensagens (merge/dedupe/sort)
// =============================================================================

function msgKey(m: AnyMsg): string {
  // Preferência: id do Firestore
  if (m?.id) return `id:${m.id}`;

  // Fallback determinístico para mensagens sem id (optimistic)
  const t = toMillisSafe((m as any)?.timestamp);
  const s = (m as any)?.senderId ?? '';
  const c = (m as any)?.content ?? '';
  return `k:${s}|${t}|${c}`;
}

function mergeMessages(existing: AnyMsg[], incoming: AnyMsg[]): AnyMsg[] {
  const map = new Map<string, AnyMsg>();

  for (const m of existing ?? []) map.set(msgKey(m), m);
  for (const m of incoming ?? []) map.set(msgKey(m), m);

  const out = Array.from(map.values());

  // Ordena asc (timeline natural)
  out.sort((a, b) => toMillisSafe((a as any).timestamp) - toMillisSafe((b as any).timestamp));
  return out;
}

function removeMessageById(list: AnyMsg[], messageId: string): AnyMsg[] {
  const id = (messageId ?? '').toString().trim();
  if (!id) return list ?? [];
  return (list ?? []).filter(m => (m as any)?.id !== id);
}

function lastMessageOf(list: AnyMsg[]): AnyMsg | null {
  if (!list?.length) return null;
  return list[list.length - 1] ?? null;
}

// =============================================================================
// Reducer
// =============================================================================

export const chatReducer = createReducer<ChatState>(
  initialChatState,

  // ---------------------------------------------------------------------------
  // LOAD CHATS
  // ---------------------------------------------------------------------------
  on(ChatActions.loadChats, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(ChatActions.loadChatsSuccess, (state, { chats }) => ({
    ...state,
    chats: upsertChats(state.chats, chats),
    loading: false,
    error: null,
  })),

  on(ChatActions.loadChatsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ---------------------------------------------------------------------------
  // CREATE CHAT
  // ---------------------------------------------------------------------------
  on(ChatActions.createChat, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(ChatActions.createChatSuccess, (state, { chat }) => ({
    ...state,
    chats: upsertChats(state.chats, [chat]),
    loading: false,
    error: null,
  })),

  on(ChatActions.createChatFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ---------------------------------------------------------------------------
  // UPDATE CHAT
  // ---------------------------------------------------------------------------
  on(ChatActions.updateChatSuccess, (state, { chatId, updateData }) => ({
    ...state,
    chats: patchChat(state.chats, chatId, updateData),
    error: null,
  })),

  on(ChatActions.updateChatFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  // ---------------------------------------------------------------------------
  // DELETE CHAT
  // ---------------------------------------------------------------------------
  on(ChatActions.deleteChatSuccess, (state, { chatId }) => {
    const nextMessages = { ...state.messages };
    delete (nextMessages as any)[chatId];

    return {
      ...state,
      chats: removeChat(state.chats, chatId),
      messages: nextMessages,
      loading: false,
      error: null,
    };
  }),

  on(ChatActions.deleteChatFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ---------------------------------------------------------------------------
  // SEND MESSAGE (optimistic local append)
  // ---------------------------------------------------------------------------
  on(ChatActions.sendMessage, (state, { chatId, message }) => {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return state;

    const current = (state.messages[cid] ?? []) as AnyMsg[];
    const merged = mergeMessages(current, [message as AnyMsg]);

    // Atualiza lastMessage no chat e reordena por atividade
    const lm = lastMessageOf(merged);
    const chatsPatched =
      lm
        ? patchChat(state.chats, cid, {
          lastMessage: {
            content: lm.content,
            nickname: lm.nickname,
            senderId: lm.senderId,
            timestamp: lm.timestamp,
            status: lm.status,
            id: (lm as any).id,
            senderUid: (lm as any).senderUid,
            createdAt: (lm as any).createdAt,
          } as any,
        })
        : state.chats;

    return {
      ...state,
      chats: chatsPatched,
      messages: {
        ...state.messages,
        [cid]: merged as Message[],
      },
      error: null,
    };
  }),

  on(ChatActions.sendMessageFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  // ---------------------------------------------------------------------------
  // REALTIME: newMessageReceived (messages do stream)
  // - Faz merge/dedupe com mensagens locais existentes.
  // ---------------------------------------------------------------------------
  on(ChatActions.newMessageReceived, (state, { chatId, messages }) => {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return state;

    const current = (state.messages[cid] ?? []) as AnyMsg[];
    const merged = mergeMessages(current, (messages ?? []) as AnyMsg[]);

    const lm = lastMessageOf(merged);
    const chatsPatched =
      lm
        ? patchChat(state.chats, cid, {
          lastMessage: {
            content: lm.content,
            nickname: lm.nickname,
            senderId: lm.senderId,
            timestamp: lm.timestamp,
            status: lm.status,
            id: (lm as any).id,
            senderUid: (lm as any).senderUid,
            createdAt: (lm as any).createdAt,
          } as any,
        })
        : state.chats;

    return {
      ...state,
      chats: chatsPatched,
      messages: {
        ...state.messages,
        [cid]: merged as Message[],
      },
      error: null,
    };
  }),

  on(ChatActions.monitorChatFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  // ---------------------------------------------------------------------------
  // DELETE MESSAGE
  // ---------------------------------------------------------------------------
  on(ChatActions.deleteMessageSuccess, (state, { chatId, messageId }) => {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return state;

    const current = (state.messages[cid] ?? []) as AnyMsg[];
    const nextList = removeMessageById(current, messageId);
    const lm = lastMessageOf(nextList);

    const chatsPatched =
      lm
        ? patchChat(state.chats, cid, {
          lastMessage: {
            content: lm.content,
            nickname: lm.nickname,
            senderId: lm.senderId,
            timestamp: lm.timestamp,
            status: lm.status,
            id: (lm as any).id,
            senderUid: (lm as any).senderUid,
            createdAt: (lm as any).createdAt,
          } as any,
        })
        : patchChat(state.chats, cid, { lastMessage: undefined } as any);

    return {
      ...state,
      chats: chatsPatched,
      messages: {
        ...state.messages,
        [cid]: nextList as Message[],
      },
      error: null,
    };
  }),

  on(ChatActions.deleteMessageFailure, (state, { error }) => ({
    ...state,
    error,
  }))
);
