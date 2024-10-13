// src/app/core/interfaces/iuser-registration-data.ts
import { Timestamp } from 'firebase/firestore';

export interface IUserRegistrationData {
  uid: string;  // O ID único do usuário
  email: string;  // O e-mail do usuário
  nickname: string;  // O apelido do usuário
  photoURL?: string;  // URL opcional da foto de perfil do usuário
  emailVerified: boolean;  // Indica se o e-mail do usuário foi verificado
  isSubscriber: boolean;  // Indica se o usuário é assinante
  estado?: string;  // Estado onde o usuário reside
  municipio?: string;  // Município onde o usuário reside
  firstLogin: Timestamp | Date;  // Data e hora do primeiro login/registro
  latitude?: number;  // Latitude do local do usuário
  longitude?: number;  // Longitude do local do usuário
  gender?: string;  // Gênero do usuário
  orientation?: string;  // Orientação sexual do usuário
  acceptedTerms: {
    accepted: true,
    date: Timestamp | Date; // Data de aceitação dos termos
  }
}
