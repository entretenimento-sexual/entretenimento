// src/app/core/services/autentication/firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
         increment, Firestore, getDoc,
         QueryConstraint} from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { CacheService } from '../general/cache.service';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private db: Firestore;

  constructor(private errorNotifier: ErrorNotificationService,
              private cacheService: CacheService) {

    const app = initializeApp(environment.firebase);
    this.db = getFirestore(app);
  }

  //Retorna a instância do Firestore.
  getFirestoreInstance(): Firestore {
    return this.db;
  }

  // Busca um único documento
  getDocument<T>(
    collectionName: string,
    docId: string,
    useCache: boolean = true,
    cacheTTL: number = 300000 // TTL padrão de 5 minutos
  ): Observable<T | null> {
    const cacheKey = `${collectionName}:${docId}`;

    // Verifica o cache
    if (useCache) {
      const cachedData = this.cacheService.get<T>(cacheKey);
      if (cachedData) {
        console.log(`[FirestoreService] Documento encontrado no cache: ${cacheKey}`);
        return of(cachedData);
      }
    }

    // Busca no Firestore
    const docRef = doc(this.db, collectionName, docId);
    return from(getDoc(docRef)).pipe(
      map((docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as T;

          // Atualiza o cache
          if (useCache) {
            this.cacheService.set(cacheKey, data, cacheTTL);
            console.log(`[FirestoreService] Documento carregado do Firestore e armazenado no cache: ${cacheKey}`);
          }

          return data;
        } else {
          console.warn(`[FirestoreService] Documento não encontrado: ${collectionName}/${docId}`);
          return null;
        }
      }),
      catchError((error) => {
        console.error(`[FirestoreService] Erro ao buscar documento ${collectionName}/${docId}:`, error);
        this.errorNotifier.showError('Erro ao buscar documento. Tente novamente mais tarde.');
        return of(null);
      })
    );
  }

  // Método para buscar vários documentos
  getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    useCache: boolean = true,
    cacheTTL: number = 300000 // 5 minutos por padrão
  ): Observable<T[]> {
    const cacheKey = `${collectionName}:${JSON.stringify(constraints)}`;

    // Verifica o cache
    if (useCache) {
      const cachedData = this.cacheService.get<T[]>(cacheKey);
      if (cachedData) {
        console.log(`[FirestoreService] Documentos encontrados no cache: ${cacheKey}`);
        return of(cachedData);
      }
    }

    // Busca no Firestore
    const collectionRef = collection(this.db, collectionName);
    const q = query(collectionRef, ...constraints);

    return from(getDocs(q)).pipe(
      map((querySnapshot) => {
        const data = querySnapshot.docs.map((doc) => doc.data() as T);

        // Atualiza o cache
        if (useCache) {
          this.cacheService.set(cacheKey, data, cacheTTL);
          console.log(`[FirestoreService] Documentos carregados do Firestore e armazenados no cache: ${cacheKey}`);
        }

        return data;
      }),
      catchError((error) => {
        console.error(`[FirestoreService] Erro ao buscar documentos na coleção ${collectionName}:`, error);
        this.errorNotifier.showError('Erro ao buscar documentos. Tente novamente mais tarde.');
        return of([]);
      })
    );
  }


  /**
   * Verifica se um apelido já existe na coleção 'users'.
   * @param nickname O apelido a ser verificado.
   * @returns Um boolean indicando se o apelido já existe.
   */
  checkIfNicknameExists(nickname: string): Observable<boolean> {
    const userCollection = collection(this.db, 'users');
    const q = query(userCollection, where('nickname', '==', nickname.trim()));

    return from(getDocs(q)).pipe(
      map((querySnapshot) => querySnapshot.size > 0),
      catchError((error) => {
        this.handleError('Erro ao verificar a existência do apelido.', error);
        return of(false);
      })
    );
  }

  /**
   * Verifica se um e-mail já existe na coleção 'users'.
   * @param email O e-mail a ser verificado.
   * @returns Um boolean indicando se o e-mail já existe.
   */
  checkIfEmailExists(email: string): Observable<boolean> {
    const userCollection = collection(this.db, 'users');
    const q = query(userCollection, where('email', '==', email.trim()));

    return from(getDocs(q)).pipe(
      map((querySnapshot) => querySnapshot.size > 0),
      catchError((error) => {
        this.handleError('Erro ao verificar a existência do e-mail.', error);
        return of(false);
      })
    );
  }

  /**
 * Salva os dados iniciais do usuário após o registro no Firestore.
 * @param uid O ID único do usuário.
 * @param userData Os dados do usuário a serem salvos.
 * @returns Observable<void>
 */
  saveInitialUserData(uid: string, userData: IUserRegistrationData): Observable<void> {
    // Garante que o campo municipioEstado seja calculado e incluído
    if (userData.municipio && userData.estado) {
      userData.municipioEstado = `${userData.municipio} - ${userData.estado}`;
    }

    const userRef = doc(this.db, 'users', uid);

    return from(setDoc(userRef, { ...userData }, { merge: true })).pipe(
      catchError((error) => {
        this.handleError('Erro ao salvar os dados iniciais do usuário.', error);
        return throwError(() => new Error('Erro ao salvar os dados iniciais do usuário.'));
      })
    );
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
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    const docRef = doc(this.db, collectionName, docId);
    return from(deleteDoc(docRef)).pipe(
      catchError((error) => {
        this.handleError('Erro ao deletar o documento.', error);
        return throwError(() => new Error('Erro ao deletar o documento.'));
      })
    );
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
