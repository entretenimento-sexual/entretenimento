// src/app/core/services/autentication/firestore.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
         increment, Firestore, getDoc,
         QueryConstraint,
         WithFieldValue} from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';
import { DocumentData } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private db: Firestore;

  constructor(private globalErrorHandler: GlobalErrorHandlerService,
              private firestoreErrorHandler: FirestoreErrorHandlerService,
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

    return (useCache ? this.cacheService.get<T>(cacheKey) : of(null)).pipe(
      switchMap(cachedData => {
        if (cachedData) {
          console.log(`[FirestoreService] Documento encontrado no cache: ${cacheKey}`);
          return of(cachedData);
        }

        // Busca no Firestore se não estiver no cache
        const docRef = doc(this.db, collectionName, docId);
        console.log(`[FirestoreService] Buscando documento do Firestore: ${collectionName}/${docId}`);

        const startTime = Date.now(); // Para medir o tempo de resposta

        return from(getDoc(docRef)).pipe(
          map(docSnap => {
            if (docSnap.exists()) {
              const data = docSnap.data() as T;

              // Atualiza o cache
              if (useCache) {
                this.cacheService.set(cacheKey, data, cacheTTL);
                console.log(`[FirestoreService] Documento armazenado no cache: ${cacheKey}`);
              }

              console.log(`[FirestoreService] Documento carregado do Firestore em ${Date.now() - startTime}ms`);
              return data;
            } else {
              console.log(`[FirestoreService] Documento não encontrado: ${collectionName}/${docId}`);
              return null;
            }
          }),
          catchError((error) => this.firestoreErrorHandler.handleFirestoreError(error))
        );
      }),
      shareReplay(1) // Evita múltiplas requisições para o mesmo documento
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

    return (useCache ? this.cacheService.get<T[]>(cacheKey) : of(null)).pipe(
      switchMap(cachedData => {
        if (cachedData) {
          console.log(`[FirestoreService] Documentos encontrados no cache: ${cacheKey}`);
          return of(cachedData);
        }

        const collectionRef = collection(this.db, collectionName);
        const q = query(collectionRef, ...constraints);

        return from(getDocs(q)).pipe(
          map((querySnapshot) => {
            const data = querySnapshot.docs.map((doc) => doc.data() as T);

            if (useCache) {
              this.cacheService.set(cacheKey, data, cacheTTL);
              console.log(`[FirestoreService] Documentos carregados do Firestore e armazenados no cache: ${cacheKey}`);
            }

            return data;
          }),
          catchError((error) => this.firestoreErrorHandler.handleFirestoreError(error))
        );
      }),
      shareReplay(1) // Evita múltiplas requisições para o mesmo conjunto de documentos
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
      catchError((error) => this.firestoreErrorHandler.handleFirestoreError(error))
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
      catchError(error => this.handleFirestoreError(error))
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
      catchError(error => this.handleFirestoreError(error))
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
      catchError(error => this.handleFirestoreError(error))
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
      catchError((error) => this.handleFirestoreError(error))
    );
  }

  // Centraliza o tratamento de erros do Firestore
  private handleFirestoreError(error: any): Observable<never> {
    this.globalErrorHandler.handleError(error);  // Delegando para o GlobalErrorHandlerService
    return throwError(() => error);
  }

  /**
  * Adiciona um documento a uma coleção no Firestore.
  * @param collectionName Nome da coleção.
  * @param data Dados a serem adicionados.
  * @returns Um Observable<void> indicando sucesso ou erro.
  */
  addDocument<T extends WithFieldValue<DocumentData>>(collectionName: string, data: T): Observable<void> {
    const docRef = doc(collection(this.db, collectionName));
    return from(setDoc(docRef, data)).pipe(
      catchError(error => this.handleFirestoreError(error))
    );
  }
}


