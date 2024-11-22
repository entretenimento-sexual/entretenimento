// src/app/core/services/batepapo/invite-search.service.ts
import { Injectable } from '@angular/core';
import { FirestoreQueryService } from '../autentication/firestore-query.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { QueryConstraint, where, orderBy } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class InviteSearchService {
  constructor(private firestoreQueryService: FirestoreQueryService) { }

  /**
   * Busca usuários elegíveis para convites.
   * @param roomId ID da sala para excluir usuários já participantes.
   * @param filters Filtros adicionais, como amigos ou usuários próximos.
   * @param searchTerm Termo de busca para nickname ou outros campos.
   * @param orderByField Campo para ordenar os resultados.
   * @param limit Número máximo de resultados.
   */
  async searchEligibleUsers(
    roomId: string,
    filters: { field: string; operator: '==' | '>=' | '<=' | 'array-contains'; value: any }[] = [],
    searchTerm: string = '',
    orderByField: string = 'nickname',
    limitResults: number = 10
  ): Promise<IUserDados[]> {
    const constraints: QueryConstraint[] = [];

    // Excluir usuários já participantes
    constraints.push(where('roomIds', 'array-contains', roomId));

    // Aplicar filtros adicionais
    filters.forEach((filter) => {
      constraints.push(where(filter.field, filter.operator, filter.value));
    });

    // Adicionar filtro por termo de busca
    if (searchTerm) {
      constraints.push(where(orderByField, '>=', searchTerm));
      constraints.push(where(orderByField, '<=', searchTerm + '\uf8ff'));
    }

    // Ordenar resultados
    constraints.push(orderBy(orderByField));

    return this.firestoreQueryService.searchUsers(constraints, limitResults);
  }
}
