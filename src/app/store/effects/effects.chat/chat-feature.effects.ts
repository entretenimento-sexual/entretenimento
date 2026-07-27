// src/app/store/effects/effects.chat/chat-feature.effects.ts
// Effects carregados apenas com a feature lazy de chat.
import { ChatEffects } from './chat.effects';

/**
 * Registro lazy da rota `/chat`.
 *
 * InviteEffects não pertence a esta lista porque o shell autenticado mantém o
 * badge global de convites ativo fora da rota de chat.
 *
 * SUPRESSÃO EXPLÍCITA:
 * RoomEffects foi removido porque nenhuma tela despachava suas actions e a área
 * de salas já possui owner reativo em RoomService/RoomFirestoreGateway, com
 * comandos protegidos em RoomManagementService/Cloud Functions.
 */
export const CHAT_FEATURE_EFFECTS = [ChatEffects];
