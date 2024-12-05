// src/app/core/services/batepapo/invite-search.service.ts
import { Injectable } from '@angular/core';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { QueryConstraint, where, orderBy, limit, getDocs, query, collection, doc, getDoc } from 'firebase/firestore';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';

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

    // Adicionar filtros adicionais
    filters.forEach((filter) => {
      constraints.push(where(filter.field, filter.operator, filter.value));
    });

    // Filtro por termo de busca
    if (searchTerm) {
      const normalizedTerm = searchTerm.trim().toLowerCase();
      console.log('Termo de busca normalizado:', normalizedTerm);
      constraints.push(where(orderByField, '>=', normalizedTerm));
      constraints.push(where(orderByField, '<=', normalizedTerm + '\uf8ff'));
    }

    // Ordenar por campo
    constraints.push(orderBy(orderByField));

    // Limitar resultados
    constraints.push(limit(limitResults));

    console.log('Consultando Firestore com os seguintes constraints:', constraints);

    try {
      const snapshot = await getDocs(query(collection(this.firestoreQueryService.getFirestoreInstance(), 'users'), ...constraints));
      console.log('Documentos encontrados:', snapshot.docs.length);

      // Filtrar usuários que ainda não estão na sala
      const results = snapshot.docs.map((doc) => doc.data() as IUserDados);
      const filteredResults = results.filter(user => !(user.roomIds?.includes(roomId)));

      console.log('Usuários elegíveis:', filteredResults);
      return filteredResults;
    } catch (error) {
      console.error('Erro ao buscar usuários no Firestore:', error);
      throw error;
    }
  }

  async getRoomDetails(roomId: string): Promise<IRoom | null> {
    const roomRef = doc(this.firestoreQueryService.getFirestoreInstance(), 'rooms', roomId);
    const roomDoc = await getDoc(roomRef);

    if (roomDoc.exists()) {
      return roomDoc.data() as IRoom;
    }

    return null;
  }

}
