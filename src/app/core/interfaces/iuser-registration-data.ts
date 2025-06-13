// src/app/core/interfaces/iuser-registration-data.ts
import { Timestamp } from 'firebase/firestore';

export interface IUserRegistrationData {
  uid?: string;  // 🔧 Tornado opcional — preenchido somente após registro
  email: string;
  nickname: string;
  photoURL?: string;
  emailVerified: boolean;
  isSubscriber: boolean;
  estado?: string;
  municipio?: string;
  municipioEstado?: string;
  firstLogin: Timestamp | Date;
  registrationDate?: Timestamp | Date;
  latitude?: number;
  longitude?: number;
  gender?: string;
  orientation?: string;
  acceptedTerms: {
    accepted: true;
    date: Timestamp | Date;
  };
  profileCompleted?: boolean;
}
