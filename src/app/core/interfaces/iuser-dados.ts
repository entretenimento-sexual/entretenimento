//src\app\core\interfaces\iuser-dados.ts
import { Timestamp } from 'firebase/firestore';
export interface IUserDados {

  uid: string; // ID do usuário
  latitude?: number; // Adicione latitude e longitude aqui
  longitude?: number;
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
  orientation?: string; // Orientação sexual
  partner1Orientation?: string;
  partner2Orientation?: string;
  estado?: string; // Estado do usuário
  municipio?: string; // Município do usuário
  isSidebarOpen?: boolean;
  preferences?: string[];
  descricao: string; // Descrição do usuário
  facebook?: string; // Perfil do Facebook
  instagram?: string; // Perfil do Instagram
  buupe: string;
  // Adicione outras redes sociais conforme necessário
}

