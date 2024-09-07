// src\app\core\services\autentication\firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, getDocs, doc, setDoc, Timestamp, updateDoc
} from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/post-verification/iuser-registration-data';
import { StorageService } from '../image-handling/storage.service';  // Importando o StorageService
import { ValidPreferences } from '../../enums/valid-preferences.enum';
import { catchError, from, map, Observable, of } from 'rxjs';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  public db = getFirestore(app);

  constructor(private storageService: StorageService) { }

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

  async saveUserProfileImage(file: File, uid: string): Promise<string> {
    const path = `user_profiles/${uid}/${file.name}`;
    const downloadUrl = await this.storageService.uploadFile(file, path);
    // Agora você pode salvar o downloadUrl no Firestore, associando-o ao usuário, se necessário.
    return downloadUrl;
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

  async saveImageState(uid: string, imageStateStr: string): Promise<void> {
    // Cria uma referência para a subcoleção "imageStates" dentro do documento do usuário
    const imageStateRef = doc(this.db, `users/${uid}/imageStates/${Date.now()}`);
    await setDoc(imageStateRef, { imageState: imageStateStr });
  }

  async getAllUsers(): Promise<IUserDados[]> {
    const usersCollection = collection(this.db, 'users');
    const snapshot = await getDocs(usersCollection);
    return snapshot.docs.map(doc => doc.data() as IUserDados);
  }

  updateDocument(collection: string, docId: string, data: Partial<any>): Observable<void> {
    const docRef = doc(this.db, collection, docId);
    return from(updateDoc(docRef, data));
  }

  public getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef,
      where('isOnline', '==', true),
      where('municipio', '==', municipio)
    );

    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => {
        console.error('Erro ao buscar usuários online por região:', error);
        return of([]);
      })
    );
  }

  public getAllOnlineUsers(): Observable<IUserDados[]> {
    // Defina a referência para a coleção 'users' e a consulta para filtrar os usuários online
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true));

    // Retorna um Observable com a lista de usuários online
    return from(getDocs(q)).pipe(
      map(snapshot => {
        const users = snapshot.docs.map(doc => doc.data() as IUserDados);
        console.log('Usuários online recuperados:', users);
        return users;
      }),
      catchError(error => {
        console.error('Erro ao buscar todos os usuários online:', error);
        return of([]);  // Retorna uma lista vazia em caso de erro
      })
    );
  }
}
