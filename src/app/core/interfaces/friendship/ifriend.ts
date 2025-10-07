//src\app\core\interfaces\friendship\ifriend.ts
export interface IFriend {
  friendUid: string;
  friendSince: Date;
  nickname?: string; // 🔥 Opcional, salva apenas o essencial para exibição
  photoURL?: string;
  municipioEstado?: string;
  idade?: number; // Idade do usuário
  gender?: string;  // Gênero do usuário
}
export interface IBlockedUser {
  nickname?: string;
  blockerUid: string;  // Usuário que bloqueia
  blockedUid: string;  // Usuário bloqueado
  timestamp: Date;     // Data do bloqueio
}
