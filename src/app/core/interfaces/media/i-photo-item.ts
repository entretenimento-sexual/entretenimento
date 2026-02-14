// src/app/core/interfaces/media/i-photo-item.ts
// Modelo central do domínio Media.
// Mantém o domínio desacoplado de componentes (evita import type de viewer).
export interface IPhotoItem {
  id: string;
  ownerUid: string;

  url: string;        // No MVP pode ser asset/preview; no futuro: downloadURL do Storage
  alt?: string;

  createdAt: number;  // epoch ms

  // Futuro (não usar ainda no MVP, mas já “prepara” a expansão):
  // visibility?: 'PRIVATE' | 'FRIENDS' | 'SUBSCRIBERS' | 'PUBLIC';
  // isSensitive?: boolean;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
