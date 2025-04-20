// src/app/core/services/batepapo/invite-search.service.ts
import { Injectable } from '@angular/core';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { QueryConstraint, where, collection, query, getDocs } from 'firebase/firestore';
import { from, Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class InviteSearchService {
  constructor(
    private firestoreQueryService: FirestoreQueryService,
    private errorNotification: ErrorNotificationService
  ) { }

  /**
   * Monta os filtros para consulta ao Firestore com base nos parâmetros fornecidos.
   * @param searchTerm Termo de busca para filtragem por nickname.
   * @param filters Filtros adicionais de consulta.
   * @returns Uma lista de QueryConstraints para o Firestore.
   */
  private buildQueryConstraints(
    searchTerm: string,
    filters: QueryConstraint[]
  ): QueryConstraint[] {
    const constraints = [...filters];

    if (searchTerm?.trim()) {
      const normalizedTerm = searchTerm.trim().toLowerCase();
      constraints.push(where('nicknameLowerCase', '>=', normalizedTerm));
      constraints.push(where('nicknameLowerCase', '<=', normalizedTerm + '\uf8ff'));
    }

    console.log('[InviteSearchService] Query Constraints:', constraints);
    return constraints;
  }

  /**
   * Realiza a busca de usuários elegíveis para um convite.
   * @param roomId ID da sala para evitar usuários já convidados.
   * @param searchTerm Termo de busca para filtrar usuários pelo nickname.
   * @param filters Filtros adicionais para a consulta.
   * @returns Observable com a lista de usuários elegíveis.
   */
  searchEligibleUsers(
    roomId: string,
    searchTerm: string = '',
    filters: QueryConstraint[] = []
  ): Observable<IUserDados[]> {
    try {
      const constraints = this.buildQueryConstraints(searchTerm, filters);
      const usersRef = collection(this.firestoreQueryService.getFirestoreInstance(), 'users');

      console.log('[InviteSearchService] Executando consulta ao Firestore com constraints:', constraints);

      return from(getDocs(query(usersRef, ...constraints))).pipe(
        map((snapshot) => {
          const users = snapshot.docs.map((doc) => {
            const data = doc.data() as IUserDados;
            console.log('[InviteSearchService] Usuário retornado:', data);
            return data;
          });

          // Filtrar usuários já na sala
          const filteredUsers = users.filter(
            (user) => !user.roomIds || !user.roomIds.includes(roomId)
          );

          console.log('[InviteSearchService] Usuários elegíveis:', filteredUsers);
          return filteredUsers;
        }),
        catchError((error) => {
          console.error('[InviteSearchService] Erro ao buscar usuários:', error);
          this.errorNotification.showError('Erro ao buscar usuários elegíveis.');
          return of([]);
        })
      );
    } catch (error) {
      console.error('[InviteSearchService] Erro inesperado:', error);
      this.errorNotification.showError('Erro inesperado ao realizar a busca.');
      return of([]);
    }
  }


  /**
   * Realiza a validação e expande os filtros de consulta para suportar novos casos de uso.
   * @param filters Filtros adicionais que podem ser usados para customizações futuras.
   */
  validateAndExpandFilters(filters: QueryConstraint[]): QueryConstraint[] {
    // Exemplo de validação e adição de filtros expansíveis
    if (filters.some((filter) => filter instanceof where)) {
      console.log('[InviteSearchService] Filtros personalizados validados:', filters);
    } else {
      console.log('[InviteSearchService] Nenhum filtro válido detectado. Adicionando padrões.');
    }

    // Retorna os filtros após a validação/expansão
    return filters;
  }
}
