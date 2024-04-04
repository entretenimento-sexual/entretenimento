//src\app\post-verification\iuser-registration-data.ts
import { Timestamp } from 'firebase/firestore';
export interface IUserRegistrationData {
  uid: string;
  email: string;
  nickname: string;
  photoURL: string;
  gender?: string;
  orientation?: string;
  firstLogin?: Timestamp | Date;
  emailVerified: boolean;
  estado?: string;
  municipio?: string;
  isSubscriber: boolean;
  role?: string;
}
