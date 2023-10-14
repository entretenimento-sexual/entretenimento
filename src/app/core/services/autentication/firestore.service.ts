// src\app\core\services\firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, getDocs, doc, setDoc, Timestamp, getDoc
} from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';

const app = initializeApp(environment.firebaseConfig);

// Enum para Preferências Válidas
enum ValidPreferences {
  SWING = 'swing',
  MENAGE = 'menage',
  SAMESEX = 'sameSex',
  EXHIBITION = 'exhibition',
  PROFESSIONALS = 'professionals',
  BDSM = 'bdsm',
  ROLEPLAY = 'roleplay',
  VOYEURISM = 'voyeurism',
  FETISH = 'fetish',
  POLYAMORY = 'polyamory',
  TRANSSEXUAL = 'transsexual',
  CROSSDRESSER = 'crossdresser',
  TRAVESTI = 'travesti'
}

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

  async saveUserDataAfterEmailVerification(user: IUserDados): Promise<void> {
    try {
      // 1. Verifica se o UID do usuário está definido.
      if (!user.uid) {
        throw new Error("UID do usuário não definido!");
      }

      // 2. Verifica se a instância do banco de dados (db) está disponível.
      if (!this.db) {
        throw new Error("Database (db) não definido!");
      }

      // 3. Cria o objeto userData com os dados que serão salvos.
      const userData = {
        ...user, // Primeiro, incluímos todas as propriedades do usuário.
        role: user.role || 'animado', // Definimos um valor padrão para o role, se necessário.
        createdAt: Timestamp.fromDate(new Date()) // Data de criação.
      };

      console.log("Dados do usuário recebidos:", userData);

      // 4. Atualiza ou salva o documento no Firestore.
      const userRef = doc(this.db, "users", user.uid);
      await setDoc(userRef, userData, { merge: true });

      console.log("Documento atualizado/salvo com sucesso!");

    } catch (error) {
      console.error("Erro ao salvar os dados do usuário após verificação de e-mail:", error);
      throw error;
    }
  }


  async getUserById(uid: string): Promise<IUserDados | null> {
    console.log('Método getUserById foi chamado com UID:', uid);
    try {
      const userRef = doc(this.db, 'users', uid);
      const userSnapshot = await getDoc(userRef);

      console.log('Snapshot recuperado:', userSnapshot.data());

      if (!userSnapshot.exists()) {
        console.log('Nenhum usuário encontrado com o uid:', uid);
        return null;
      }
      return userSnapshot.data() as IUserDados;
    } catch (error) {
      console.error('Erro ao obter usuário por uid:', error);
      throw error;
    }
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

  async getUserPreferencesByToken(token: string): Promise<any | null> {
    console.log("Entrando em getUserPreferencesByToken com o token:", token);

    const preRegisterCollection = collection(this.db, "preRegisterPreferences");
    const preRegisterQuery = query(preRegisterCollection, where("token", "==", token));
    const userSnapshots = await getDocs(preRegisterQuery);

    if (userSnapshots.empty) {
      console.log(`Nenhuma preferência encontrada para o token: ${token}`);
      return null;
    }
    return userSnapshots.docs[0].data();
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
}
