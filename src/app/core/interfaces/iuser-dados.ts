//src\app\core\interfaces\iuser-dados.ts
import { Timestamp } from 'firebase/firestore';
export interface IUserDados {

  uid: string; // ID do usuário
  latitude?: number; // Adicione latitude e longitude aqui
  longitude?: number;
  distanciaKm?: number;
  email: string | null; // Email do usuário
  displayName: string | null | undefined;
  photoURL: string | null | undefined;
  nickname?: string; // Apelido do usuário
  nome?: string; // Nome completo do usuário
  idade?: number; // Idade do usuário
  role: 'visitante' |'free' | 'basico' | 'premium' | 'vip';
  lastLoginDate: Timestamp; // Data do último login
  firstLogin: Timestamp | Date | null;
  createdAt?: Timestamp | Date | null;
  emailVerified?: string;
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

  //relativo ao estado geral de usuário
  isOnline?: boolean;
  isSubscriber: boolean;
  singleRoomCreationRightExpires?: Date;
  roomCreationSubscriptionExpires?: Date;
  monthlyPayer?: boolean;
  subscriptionExpires?: Date;
}

