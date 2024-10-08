// src\app\core\services\firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserPreferences } from '../../interfaces/iuser-preferences';
import { ValidPreferences } from '../../enums/valid-preferences.enum';
import { IUserRegistrationData } from 'src/app/post-verification/iuser-registration-data';

// Inicializando o app do Firebase com o novo método modular
const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  public db = getFirestore(app);

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

  async saveInitialUserData(uid: string, userData: IUserRegistrationData): Promise<void> {
    const userRef = doc(this.db, "users", uid);
    console.log("Salvando no Firestore:", userData);
    await setDoc(userRef, userData, { merge: true });
  }

  async saveUserDataAfterEmailVerification(user: IUserDados): Promise<void> {
    try {
      if (!user.uid) {
        throw new Error("UID do usuário não definido!");
      }
      if (!this.db) {
        throw new Error("Database (db) não definido!");
      }
      const userData = {
        ...user,
        role: user.role || 'basico',
        createdAt: Timestamp.fromDate(new Date())
      };

      console.log("Dados do usuário recebidos:", userData);

      const userRef = doc(this.db, "users", user.uid);
      await setDoc(userRef, userData, { merge: true });

      console.log("Documento atualizado/salvo com sucesso!");

    } catch (error) {
      console.error("Erro ao salvar os dados do usuário após verificação de e-mail:", error);
      throw error;
    }
  }

  async updateEmailVerificationStatus(uid: string, isVerified: boolean): Promise<void> {
    const userRef = doc(this.db, "users", uid);
    await updateDoc(userRef, {
      emailVerified: isVerified,
      ...(isVerified ? { role: 'free' } : {})
    });
  }

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

  async getSuggestedProfilesMatchingPreferences(preferences: any): Promise<IUserDados[]> {
    console.log("Entrando em getSuggestedProfilesMatchingPreferences com preferências:", preferences);

    let allMatches: IUserDados[] = [];
    const userCollection = collection(this.db, "users");

    for (const preference in preferences) {
      if (preferences[preference] && preference in ValidPreferences) {
        console.log("Buscando por perfis com a preferência:", preference);

        const userQuery = query(userCollection, where(preference, "==", true));
        const userSnapshots = await getDocs(userQuery);

        if (userSnapshots.docs.length > 0) {
          console.log(`Encontrados ${userSnapshots.docs.length} usuários com a preferência ${preference}`);
        } else {
          console.log(`Nenhum usuário encontrado com a preferência ${preference}`);
        }

        allMatches = [...allMatches, ...userSnapshots.docs.map(doc => doc.data() as IUserDados)];
      }
    }

    const uniqueMatches = Array.from(new Set(allMatches.map(u => u.uid)))
      .map(uid => allMatches.find(user => user.uid === uid))
      .filter(Boolean) as IUserDados[];

    console.log("Usuários únicos encontrados:", uniqueMatches);
    return uniqueMatches;
  }

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

  async getUserPreferences(uid: string): Promise<IUserPreferences> {
    const preferencesCollectionRef = collection(this.db, `users/${uid}/preferences`);
    const querySnapshot = await getDocs(preferencesCollectionRef);

    const preferences: IUserPreferences = {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: []
    };

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // Ajuste conforme a estrutura dos seus documentos
      preferences[doc.id] = data['value'];
    });

    return preferences;
  }

  async getProfilesNearLocation(latitude: number, longitude: number, geohash: string): Promise<IUserDados[]> {
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection, /* adicione as condições de consulta aqui */);

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => doc.data() as IUserDados);
    } catch (error) {
      console.error('Erro ao buscar perfis próximos:', error);
      throw error;
    }
  }
}
