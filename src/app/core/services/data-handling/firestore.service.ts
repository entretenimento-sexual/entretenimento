//src\app\core\services\autentication\firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
        increment, Firestore } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { from, Observable } from 'rxjs';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  
  constructor() { }

  private db = getFirestore();
  getFirestoreInstance(): Firestore {
    return this.db;
  }

  // Verifica se um apelido já existe na coleção 'users'
  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    console.log(`Iniciando consulta ao Firestore para verificar o apelido: "${nickname}"`);
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection, where('nickname', '==', nickname)); // Comparação exata
      const querySnapshot = await getDocs(q);
      const exists = querySnapshot.size > 0;
      console.log(`Consulta completa: o apelido "${nickname}" ${exists ? 'já existe' : 'não existe'}.`);
      return exists;
    } catch (error) {
      console.error('Erro ao verificar a existência do apelido no Firestore:', error);
      throw error;
    }
  }

  // Verifica se um e-mail já existe na coleção 'users'
  async checkIfEmailExists(email: string): Promise<boolean> {
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection, where('email', '==', email));
      const querySnapshot = await getDocs(q);
      return querySnapshot.size > 0;
    } catch (error) {
      console.error('Erro ao verificar a existência do e-mail:', error);
      throw error;
    }
  }

  // Salva os dados iniciais do usuário após o registro no Firestore
  async saveInitialUserData(uid: string, userData: IUserRegistrationData): Promise<void> {
    const userRef = doc(this.db, 'users', uid);
    await setDoc(userRef, { ...userData, emailVerified: true }, { merge: true });
    console.log(`Dados do usuário salvos no Firestore com email verificado.`);
  }

  // Incrementa um campo no documento do Firestore
  incrementField(collectionName: string, docId: string, fieldName: string, incrementBy: number): Observable<void> {
    const docRef = doc(this.db, collectionName, docId);
    // Usando 'from' para converter o Promise em Observable
    return from(updateDoc(docRef, { [fieldName]: increment(incrementBy) }).then(() => {
      console.log(`${fieldName} incrementado por ${incrementBy} no documento ${docId}`);
    }));
  }

  // Deleta um documento do Firestore
  async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await deleteDoc(docRef);
      console.log(`Documento ${docId} deletado com sucesso da coleção ${collectionName}.`);
    } catch (error) {
      console.error(`Erro ao deletar o documento ${docId}:`, error);
      throw error;
    }
  }

  // Atualiza qualquer documento no Firestore com base no ID e dados fornecidos
  updateDocument(collection: string, docId: string, data: Partial<any>): Observable<void> {
    const docRef = doc(this.db, collection, docId);
    return from(updateDoc(docRef, data));
  }
}
