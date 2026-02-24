// src/app/core/interfaces/iuser-dados.ts
import { IUserSocialLinks } from './interfaces-user-dados/iuser-social-links';

export interface IUserDados {
  uid: string;
  nickname?: string | null;
  roomIds?: string[];

  latitude?: number;
  longitude?: number;
  distanciaKm?: number | undefined;

  email: string | null;
  photoURL: string | null | undefined;
  nome?: string;
  idade?: number;

  role: 'visitante' | 'free' | 'basic' | 'premium' | 'vip';

  // 🔁 AGORA COMO EPOCH (ms)
  lastLogin: number;                    // obrigatório (ex: 0 se faltar)
  firstLogin?: number | null;
  createdAt?: number | null;

  emailVerified?: boolean;

  gender?: string;
  orientation?: string;
  partner1Orientation?: string;
  partner2Orientation?: string;
  estado?: string;
  municipio?: string;
  isSidebarOpen?: boolean;
  preferences?: string[];
  descricao: string;

  isOnline?: boolean;
  isSubscriber: boolean;

  // assinaturas/expirações como epoch (ms)
  singleRoomCreationRightExpires?: number | null;
  roomCreationSubscriptionExpires?: number | null;
  monthlyPayer?: boolean;
  subscriptionExpires?: number | null;
  acceptedTerms?: { accepted: boolean; date: number | null };
  nicknameHistory?: Array<{ nickname: string; date: number | null }>;
  socialLinks?: IUserSocialLinks;
  profileCompleted?: boolean;
  suspended?: boolean;

  // presença (se você usa no doc)
  lastSeen?: number | null;
  lastOfflineAt?: number | null;
  lastOnlineAt?: number | null;
  lastLocationAt?: number | null;
  registrationDate?: number | null;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
// CurrentUserStoreService como fonte canônica do IUserDados (perfil/hidratação).
