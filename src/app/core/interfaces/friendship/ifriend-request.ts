//src\app\core\interfaces\friendship\ifriend-request.ts
export interface IFriendRequest {
  requesterUid: string;  // Usuário que enviou a solicitação
  recipientUid: string;  // Usuário que recebe a solicitação
  type: 'friend' | 'request' | 'blocked' | 'follower'; // Tipo da relação
  message?: string; // Mensagem opcional (exemplo: em solicitações de amizade)
  timestamp: Date; // Data de criação
  expiresAt: Date; // Expiração (exemplo: em solicitações de amizade)
}
