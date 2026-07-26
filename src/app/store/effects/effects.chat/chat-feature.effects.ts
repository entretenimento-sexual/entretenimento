// src/app/store/effects/effects.chat/chat-feature.effects.ts
// Effects carregados apenas com a feature lazy de chat.
import { ChatEffects } from './chat.effects';
import { RoomEffects } from './room.effects';

/**
 * Registro lazy da rota `/chat`.
 *
 * InviteEffects não pertence a esta lista porque o shell autenticado mantém o
 * badge global de convites ativo fora da rota de chat.
 */
export const CHAT_FEATURE_EFFECTS = [ChatEffects, RoomEffects];
