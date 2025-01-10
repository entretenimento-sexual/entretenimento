// src/app/core/services/autentication/firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
  increment, Firestore
} from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { from, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private db: Firestore;

  constructor(private errorNotifier: ErrorNotificationService) {
    // Inicializa o Firestore com as credenciais do ambiente
    this.db = getFirestore(initializeApp(environment.firebase));
  }

  /**
   * Retorna a instância do Firestore.
   */
  getFirestoreInstance(): Firestore {
    return this.db;
  }

  /**
   * Verifica se um apelido já existe na coleção 'users'.
   * @param nickname O apelido a ser verificado.
   * @returns Um boolean indicando se o apelido já existe.
   */
  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection, where('nickname', '==', nickname.trim()));
      const querySnapshot = await getDocs(q);
      return querySnapshot.size > 0;
    } catch (error) {
      this.handleError('Erro ao verificar a existência do apelido.', error);
      throw error;
    }
  }

  /**
   * Verifica se um e-mail já existe na coleção 'users'.
   * @param email O e-mail a ser verificado.
   * @returns Um boolean indicando se o e-mail já existe.
   */
  async checkIfEmailExists(email: string): Promise<boolean> {
    try {
      const userCollection = collection(this.db, 'users');
      const q = query(userCollection, where('email', '==', email.trim()));
      const querySnapshot = await getDocs(q);
      return querySnapshot.size > 0;
    } catch (error) {
      this.handleError('Erro ao verificar a existência do e-mail.', error);
      throw error;
    }
  }

  /**
   * Salva os dados iniciais do usuário após o registro no Firestore.
   * @param uid O ID único do usuário.
   * @param userData Os dados do usuário a serem salvos.
   */
  async saveInitialUserData(uid: string, userData: IUserRegistrationData): Promise<void> {
    try {
      const userRef = doc(this.db, 'users', uid);
      await setDoc(userRef, { ...userData, emailVerified: true }, { merge: true });
    } catch (error) {
      this.handleError('Erro ao salvar os dados iniciais do usuário.', error);
      throw error;
    }
  }

  /**
   * Incrementa um campo no documento do Firestore.
   * @param collectionName Nome da coleção.
   * @param docId ID do documento.
   * @param fieldName Nome do campo a ser incrementado.
   * @param incrementBy Valor do incremento.
   * @returns Um Observable<void> indicando o sucesso ou falha da operação.
   */
  incrementField(collectionName: string, docId: string, fieldName: string, incrementBy: number): Observable<void> {
    const docRef = doc(this.db, collectionName, docId);
    return from(updateDoc(docRef, { [fieldName]: increment(incrementBy) })).pipe(
      catchError((error) => this.notifyAndThrowError('Erro ao incrementar o campo.', error))
    );
  }

  /**
   * Deleta um documento do Firestore.
   * @param collectionName Nome da coleção.
   * @param docId ID do documento.
   */
  async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await deleteDoc(docRef);
    } catch (error) {
      this.handleError('Erro ao deletar o documento.', error);
      throw error;
    }
  }

  /**
   * Atualiza qualquer documento no Firestore com base no ID e dados fornecidos.
   * @param collection Nome da coleção.
   * @param docId ID do documento.
   * @param data Dados a serem atualizados.
   * @returns Um Observable<void> indicando o sucesso ou falha da operação.
   */
  updateDocument(collection: string, docId: string, data: Partial<any>): Observable<void> {
    const docRef = doc(this.db, collection, docId);
    return from(updateDoc(docRef, data)).pipe(
      catchError((error) => this.notifyAndThrowError('Erro ao atualizar o documento.', error))
    );
  }

  /**
   * Trata erros e notifica o usuário via serviço de notificações.
   * @param userMessage Mensagem amigável para o usuário.
   * @param error O erro capturado.
   */
  private handleError(userMessage: string, error: any): void {
    console.error(userMessage, error);
    this.errorNotifier.showError(userMessage);
  }

  /**
   * Notifica e lança um erro em um Observable.
   * @param userMessage Mensagem amigável para o usuário.
   * @param error O erro capturado.
   * @returns Um Observable que lança o erro.
   */
  private notifyAndThrowError(userMessage: string, error: any): Observable<never> {
    this.handleError(userMessage, error);
    return throwError(() => new Error(userMessage));
  }
}
