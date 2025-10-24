//src\app\core\interfaces\user-public.interface.ts
export interface UserPublic {
  uid: string;

  // o que os cards de solicitações usam:
  nickname?: string;
  avatarUrl?: string;
  isOnline?: boolean;
  role?: string;         // 'vip' | 'premium' | 'basic' | etc.
  gender?: string;
  age?: number;
  orientation?: string;
  municipio?: string;
  estado?: string;
  photos?: string[];     // urls de miniaturas
}
