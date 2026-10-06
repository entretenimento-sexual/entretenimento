// src/app/core/interfaces/media/i-photo-item.ts
// Modelo central do domínio Media.
// Mantém o domínio desacoplado de componentes (evita import type de viewer).
export interface IPhotoItem {
  id: string;
  ownerUid: string;

  url: string;        // URL de apresentação hidratada em runtime; nunca é autoridade persistida do ativo
  alt?: string;

  createdAt: number;  // epoch ms: data técnica de criação/upload
  displayDate?: number | null; // epoch ms: data escolhida pelo usuário para organizar a galeria

  path?: string;
   fileName?: string;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
