//src\app\core\services\data-handling\firestore-validation.service.ts
// src/app/core/services/data-handling/firestore-validation.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs } from 'firebase/firestore';
import { Observable, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';

@Injectable({
  providedIn: 'root'
})
export class FirestoreValidationService {

  constructor(private db: Firestore, private firestoreErrorHandler: FirestoreErrorHandlerService) { }

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
      catchError((error) => this.firestoreErrorHandler.handleFirestoreError(error))
    );
  }
}
