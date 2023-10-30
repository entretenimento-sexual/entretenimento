//src\app\core\interfaces\iuser-dados.ts
import { Timestamp } from 'firebase/firestore';
export interface IUserDados {

  uid: string; // ID do usuário
  email: string | null; // Email do usuário
  displayName: string | null | undefined;
  photoURL: string | null | undefined;
  nickname?: string; // Apelido do usuário
  nome?: string; // Nome completo do usuário
  idade?: number; // Idade do usuário
  role: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase'; // Função/role do usuário
  lastLoginDate: Timestamp; // Data do último login
  firstLogin?: Timestamp | Date;
  emailVerified?: boolean;
  gender?: string;
  orientation?: string;
  isSidebarOpen?: boolean;
}

