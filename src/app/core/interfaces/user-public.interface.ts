// src/app/core/interfaces/user-public.interface.ts
export interface UserPublic {
  uid: string;

  nickname?: string;
  avatarUrl?: string;

  // compat opcional (se sua UI ainda usa photoURL)
  photoURL?: string;

  isOnline?: boolean;

  // ✅ presença (para query de recentes)
  lastSeen?: number;        // epoch ms
  lastOnlineAt?: number;    // epoch ms
  lastOfflineAt?: number;   // epoch ms

  role?: string;
  gender?: string;
  age?: number;
  orientation?: string;
  municipio?: string;
  estado?: string;
  photos?: string[];

  // ✅ geo “safe/coarse” (se você precisa calcular distância no client)
  latitude?: number;
  longitude?: number;
  geohash?: string;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
