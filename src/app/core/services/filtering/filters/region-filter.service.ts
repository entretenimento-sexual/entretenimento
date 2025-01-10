// src\app\core\services\filtering\filters\region-filter.service.ts
import { Injectable } from '@angular/core';
import { catchError, from, map, Observable, of } from 'rxjs';
import { collection, doc, getDoc, getDocs, query, QueryConstraint, QueryDocumentSnapshot, where } from 'firebase/firestore';
import { FirestoreService } from '../../data-handling/firestore.service';
import { IBGELocationService } from '../../general/api/ibge-location.service';

@Injectable({
  providedIn: 'root',
})
export class RegionFilterService {
  constructor(
    private firestoreService: FirestoreService,
    private ibgeLocationService: IBGELocationService
  ) { }

  /**
  * Obtém a UF e o município do usuário logado.
  * @param uid ID do usuário logado.
  * @returns Observable com as informações de UF e município.
  */
  getUserRegion(uid: string): Observable<{ uf: string; city: string } | null> {
    if (!uid) return of(null);

    const userDocRef = doc(this.firestoreService.getFirestoreInstance(), `users/${uid}`);
    return new Observable((observer) => {
      getDoc(userDocRef)
        .then((docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('Dados obtidos do Firestore:', data)
            observer.next({
              uf: data?.['estado'] || '',
              city: data?.['municipio'] || '',
            });
          } else {
            observer.next(null);
          }
          observer.complete();
        })
        .catch((error) => {
          console.error('Erro ao buscar região do usuário:', error);
          observer.error(error);
        });
    });
  }


  /**
   * Aplica filtros para encontrar usuários na região especificada.
   * @param uf Unidade Federativa (UF).
   * @param city Cidade.
   * @returns Array de QueryConstraints para o Firestore.
   */
  applyRegionFilters(uf?: string, city?: string): QueryConstraint[] {
    const constraints: QueryConstraint[] = [];

    if (uf?.trim()) {
      constraints.push(where('estado', '==', uf.toUpperCase().trim())); // Certifique-se de que 'estado' é o nome correto no Firestore
    }

    if (city?.trim()) {
      constraints.push(where('municipio', '==', city.toLowerCase().trim())); // Certifique-se de que 'municipio' é o nome correto no Firestore
    }

    return constraints;
  }


  /**
   * Busca usuários de uma região no Firestore.
   * @param uf Unidade Federativa (UF).
   * @param city Cidade.
   * @returns Observable com a lista de usuários.
   */
  getUsersInRegion(uf?: string, city?: string): Observable<any[]> {
    const constraints = this.applyRegionFilters(uf, city);
    const usersCollection = collection(this.firestoreService.getFirestoreInstance(), 'users');
    const q = query(usersCollection, ...constraints);

    return from(getDocs(q)).pipe(
      map((snapshot) =>
        snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
          id: doc.id,
          ...doc.data(),
        }))
      ),
      catchError((error) => {
        console.error('Erro ao buscar usuários por região:', error);
        return of([]);
      })
    );
  }

  /**
   * Valida se um estado e município existem no IBGE.
   * @param uf Unidade Federativa.
   * @param city Cidade.
   * @returns Observable indicando se a combinação é válida.
   */
  validateRegion(uf: string, city: string): Observable<boolean> {
    return this.ibgeLocationService.getMunicipios(uf).pipe(
      map((municipios) => municipios.some((municipio) => municipio.nome.toLowerCase() === city.toLowerCase()))
    );
  }
}
