// src/app/core/interfaces/iuser-registration-data.ts
export interface IUserRegistrationData {
  uid?: string;                 // preenchido depois do registro, se precisar
  email: string;
  nickname: string;
  photoURL?: string;

  emailVerified: boolean;
  isSubscriber: boolean;

  estado?: string;
  municipio?: string;
  municipioEstado?: string;

  // 🔁 agora como epoch (ms)
  firstLogin: number;           // ex.: Date.now()
  registrationDate?: number | null;

  latitude?: number;
  longitude?: number;
  gender?: string;
  orientation?: string;

  acceptedTerms: {
    accepted: boolean;
    date: number | null;        // ex.: Date.now()
  };

  profileCompleted?: boolean;
}
