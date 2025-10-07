//src\app\core\interfaces\iuser-dados.ts
import { Timestamp } from 'firebase/firestore';
import { IUserSocialLinks } from './interfaces-user-dados/iuser-social-links';
export interface IUserDados {

  uid: string; // ID do usuário
  nickname?: string | null;
  roomIds?: string[];
  latitude?: number; // Adicione latitude e longitude aqui
  longitude?: number;
  distanciaKm?: number | undefined;
  email: string | null; // Email do usuário
  photoURL: string | null | undefined;
  nome?: string; // Nome completo do usuário
  idade?: number; // Idade do usuário
  role: 'visitante' |'free' | 'basic' | 'premium' | 'vip';
  lastLogin: Timestamp; // Data do último login
  firstLogin: Timestamp | Date | null;
  createdAt?: Timestamp | Date | null; //Data da criação do perfil pelo usuário
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

  //relativo ao estado geral de usuário
  isOnline?: boolean;
  isSubscriber: boolean;
  singleRoomCreationRightExpires?: Date;
  roomCreationSubscriptionExpires?: Date;
  monthlyPayer?: boolean;
  subscriptionExpires?: Date;
  socialLinks?: IUserSocialLinks;

  profileCompleted?: boolean;
  suspended?: boolean;
}

