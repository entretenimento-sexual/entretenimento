// src\app\messaging\direct-discovery\models\desired-profile.models.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
// Lembrar das imposições de restrições de participação em chats e mensagens
export type DesiredProfileKind =
  | 'man'
  | 'woman'
  | 'couple'
  | 'trans'
  | 'non-binary'
  | 'other';

export interface DesiredProfile {
  uid: string;
  nickname: string;
  photoURL?: string;
  profileKinds: DesiredProfileKind[];
  lookingFor: DesiredProfileKind[];
  region?: string;
  online?: boolean;
  lastActiveAt?: number;
  score?: number;
}
