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

/* C:.
│   geolocation.interface.ts
│   icategoria - mapeamento.ts
│   ierror.ts
│   iuser - dados.ts
│   iuser - registration - data.ts
│   user - public.interface.ts
│
├───friendship
│       blocked - user.interface.ts
│       friend - request.interface.ts
│       friend.interface.ts
│
├───interfaces - chat
│       chat.interface.ts
│       community.interface.ts
│       invite.interface.ts
│       message.interface.ts
│       room.interface.ts
│
├───interfaces - user - dados
│       iuser - preferences.ts
│       iuser - social - links.ts
│
└───logs
iadming - log.ts */
