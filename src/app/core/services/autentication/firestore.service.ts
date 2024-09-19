import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { catchError, from, map, Observable, of } from 'rxjs';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  public db = getFirestore(app);

  constructor() { }

  // Verifica se um apelido já existe na coleção 'users'
  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection, where('nickname', '==', nickname));
      const querySnapshot = await getDocs(q);
      return querySnapshot.size > 0;
    } catch (error) {
      console.error('Erro ao verificar a existência do apelido:', error);
      throw error;
    }
  }

  // Salva os dados iniciais do usuário após o registro no Firestore
  async saveInitialUserData(uid: string, userData: IUserRegistrationData): Promise<void> {
    const userRef = doc(this.db, "users", uid);
    await setDoc(userRef, userData, { merge: true });
  }

  // Atualiza os dados do usuário após a verificação de e-mail
  async saveUserDataAfterEmailVerification(user: IUserDados): Promise<void> {
    try {
      if (!user.uid) throw new Error("UID do usuário não definido!");
      const userData = { ...user, role: user.role || 'basico', createdAt: Timestamp.fromDate(new Date()) };
      const userRef = doc(this.db, "users", user.uid);
      await setDoc(userRef, userData, { merge: true });
    } catch (error) {
      console.error("Erro ao salvar os dados do usuário após verificação de e-mail:", error);
      throw error;
    }
  }

  // Atualiza o status de verificação de e-mail do usuário
  async updateEmailVerificationStatus(uid: string, isVerified: boolean): Promise<void> {
    const userRef = doc(this.db, "users", uid);
    await updateDoc(userRef, { emailVerified: isVerified, ...(isVerified ? { role: 'free' } : {}) });
  }

  // Busca perfis sugeridos para o usuário com base nas preferências
  async getSuggestedProfiles(): Promise<IUserDados[]> {
    try {
      const userCollection = collection(this.db, 'users');
      const querySnapshot = await getDocs(userCollection);
      return querySnapshot.docs.map(doc => doc.data() as IUserDados);
    } catch (error) {
      console.error('Erro ao buscar perfis sugeridos:', error);
      throw error;
    }
  }

  // Busca perfis por orientação, localização e gênero
  async getProfilesByOrientationAndLocation(gender: string, orientation: string, municipio: string): Promise<IUserDados[]> {
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection,
        where('gender', '==', gender),
        where('orientation', '==', orientation),
        where('municipio', '==', municipio)
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => doc.data() as IUserDados);
    } catch (error) {
      console.error('Erro ao buscar perfis:', error);
      throw error;
    }
  }

  // Obtém todos os usuários da coleção 'users'
  async getAllUsers(): Promise<IUserDados[]> {
    const usersCollection = collection(this.db, 'users');
    const snapshot = await getDocs(usersCollection);
    return snapshot.docs.map(doc => doc.data() as IUserDados);
  }

  // Atualiza qualquer documento no Firestore com base no ID e dados fornecidos
  updateDocument(collection: string, docId: string, data: Partial<any>): Observable<void> {
    const docRef = doc(this.db, collection, docId);
    return from(updateDoc(docRef, data));
  }

  // Obtém usuários online por região
  public getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true), where('municipio', '==', municipio));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => of([]))
    );
  }

  // Obtém todos os usuários online em tempo real
  public getAllOnlineUsers(): Observable<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => of([]))
    );
  }
}
