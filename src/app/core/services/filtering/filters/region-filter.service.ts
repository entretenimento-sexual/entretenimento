// src/app/core/services/filtering/filters/region-filter.service.ts
// Não esquecer dos comentários explicativos e ferramentas de debug.
//
// AJUSTES DESTA VERSÃO:
// - SUPRIMIDO o uso do FirestoreService legado
// - Firestore agora é injetado diretamente via AngularFire
// - removido Observable manual em getUserRegion()
// - removidos console.log espalhados
// - erros passam pelo GlobalErrorHandlerService + ErrorNotificationService
// - mantidas as nomenclaturas públicas: getUserRegion / applyRegionFilters / getUsersInRegion / validateRegion
//
// OBSERVAÇÃO:
// - mantive a assinatura de getUsersInRegion() compatível.
// - mantive o filtro por 'estado' e 'municipio' exatamente como já existia.
// - se depois você quiser, dá para evoluir esse service para um repository read-only.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  where,
} from '@angular/fire/firestore';
import { catchError, from, map, Observable, of, throwError } from 'rxjs';

import { IBGELocationService } from '../../general/api/ibge-location.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

export interface UserRegion {
  uf: string;
  city: string;
}

export type RegionUserResult = {
  id: string;
} & Record<string, unknown>;

@Injectable({
  providedIn: 'root',
})
export class RegionFilterService {
  private readonly firestore = inject(Firestore);

  constructor(
    private readonly ibgeLocationService: IBGELocationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  /**
   * Obtém a UF e o município do usuário logado.
   * @param uid ID do usuário logado.
   * @returns Observable com as informações de UF e município.
   */
  getUserRegion(uid: string): Observable<UserRegion | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) {
      return of(null);
    }

    const userDocRef = doc(this.firestore, `users/${safeUid}`);

    return from(getDoc(userDocRef)).pipe(
      map((docSnap) => {
        if (!docSnap.exists()) {
          return null;
        }

        const data = docSnap.data();

        return {
          uf: String(data?.['estado'] ?? ''),
          city: String(data?.['municipio'] ?? ''),
        };
      }),
      catchError((error) => {
        const normalizedError = this.normalizeError(
          error,
          'Erro ao buscar região do usuário.',
          { op: 'getUserRegion', uid: safeUid }
        );

        this.errorHandler.handleError(normalizedError);
        this.errorNotifier.showError('Erro ao buscar região do usuário.');

        return throwError(() => normalizedError);
      })
    );
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
      constraints.push(where('estado', '==', uf.toUpperCase().trim()));
    }

    if (city?.trim()) {
      constraints.push(where('municipio', '==', city.toLowerCase().trim()));
    }

    return constraints;
  }

  /**
   * Busca usuários de uma região no Firestore.
   * @param uf Unidade Federativa (UF).
   * @param city Cidade.
   * @returns Observable com a lista de usuários.
   */
  getUsersInRegion(uf?: string, city?: string): Observable<RegionUserResult[]> {
    const constraints = this.applyRegionFilters(uf, city);
    const usersCollection = collection(this.firestore, 'users');
    const q = query(usersCollection, ...constraints);

    return from(getDocs(q)).pipe(
      map((snapshot) =>
        snapshot.docs.map((docSnap: QueryDocumentSnapshot) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }))
      ),
      catchError((error) => {
        const normalizedError = this.normalizeError(
          error,
          'Erro ao buscar usuários por região.',
          { op: 'getUsersInRegion', uf, city }
        );

        this.errorHandler.handleError(normalizedError);
        this.errorNotifier.showError('Erro ao buscar usuários por região.');

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
      map((municipios) =>
        municipios.some(
          (municipio) => municipio.nome.toLowerCase() === city.toLowerCase()
        )
      ),
      catchError((error) => {
        const normalizedError = this.normalizeError(
          error,
          'Erro ao validar região.',
          { op: 'validateRegion', uf, city }
        );

        this.errorHandler.handleError(normalizedError);
        return of(false);
      })
    );
  }

  private normalizeError(
    error: unknown,
    fallbackMessage: string,
    context?: Record<string, unknown>
  ): Error {
    const normalizedError =
      error instanceof Error ? error : new Error(fallbackMessage);

    (normalizedError as any).original = error;
    (normalizedError as any).context = {
      scope: 'RegionFilterService',
      ...(context ?? {}),
    };
    (normalizedError as any).skipUserNotification = true;

    return normalizedError;
  }
}