// src/app/core/services/batepapo/invite-search.service.ts
import { Injectable } from '@angular/core';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { QueryConstraint, where, orderBy, limit, collection, query, getDocs } from 'firebase/firestore';
import { from, Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class InviteSearchService {
  constructor(
    private firestoreQueryService: FirestoreQueryService,
    private errorNotification: ErrorNotificationService
  ) { }

  private buildQueryConstraints(searchTerm: string, filters: QueryConstraint[]): QueryConstraint[] {
    const constraints = [...filters];
    if (searchTerm) {
      const normalizedTerm = searchTerm.trim().toLowerCase();
      constraints.push(where('nickname', '>=', normalizedTerm));
      constraints.push(where('nickname', '<=', normalizedTerm + '\uf8ff'));
    }
    return constraints;
  }

  searchEligibleUsers(
    roomId: string,
    searchTerm: string = '',
    filters: QueryConstraint[] = []
  ): Observable<IUserDados[]> {
    const constraints = this.buildQueryConstraints(searchTerm, filters);
    const usersRef = collection(this.firestoreQueryService.getFirestoreInstance(), 'users');

    return from(getDocs(query(usersRef, ...constraints))).pipe(
      map((snapshot) => {
        const users = snapshot.docs.map((doc) => doc.data() as IUserDados);
        return users.filter((user) => !(user.roomIds?.includes(roomId))); // Remove usuários já na sala
      }),
      catchError((error) => {
        console.error('Erro ao buscar usuários elegíveis:', error);
        this.errorNotification.showError('Erro ao buscar usuários elegíveis.');
        throw error;
      })
    );
  }
}
