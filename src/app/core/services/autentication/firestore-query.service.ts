//src\app\core\services\autentication\firestore-query.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { initializeApp } from 'firebase/app';
import { IUserDados } from '../../interfaces/iuser-dados';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreQueryService {
  private db = getFirestore(app);

  constructor() { }

  // Método para buscar os dados de um usuário específico no Firestore
  async getUserData(uid: string): Promise<IUserDados | null> {
    try {
      const userRef = doc(this.db, 'users', uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        return userDoc.data() as IUserDados;
      } else {
        console.warn('Usuário não encontrado.');
        return null;
      }
    } catch (error) {
      console.error('Erro ao buscar dados do usuário:', error);
      throw error;
    }
  }
}
