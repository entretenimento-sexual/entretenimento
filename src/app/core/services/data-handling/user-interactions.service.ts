// src\app\core\services\user-interactions.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreService } from './firestore.service';
import { AuthService } from '../autentication/auth.service';
import { doc, setDoc, collection, query, where, getDocs } from '@firebase/firestore';
import { FirestoreUserQueryService } from './firestore-user-query.service';
import { Observable, from, forkJoin } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class UserInteractionsService {
  amigos: IUserDados[] = [];

  constructor(
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private authService: AuthService
  ) { }

  /**
   * Lista amigos de um usuário por meio de suas conexões no Firestore.
   * @param userId ID do usuário logado.
   * @returns Promise com uma lista de amigos (IUserDados).
   */
  async listFriends(userId: string): Promise<IUserDados[]> {
    try {
      const friendsQuery = query(collection(this.firestoreService.db, 'amigos'), where('userId1', '==', userId));
      const querySnapshot = await getDocs(friendsQuery);

      // Transformar os documentos em promessas de busca detalhada
      const friendPromises = querySnapshot.docs.map(async (docSnapshot) => {
        const friendId = docSnapshot.data()['userId2'];
        return this.firestoreUserQuery.getUserData(friendId);
      });

      // Resolver todas as promessas para consolidar os amigos
      const friends = await Promise.all(friendPromises);
      return friends.filter((friend): friend is IUserDados => !!friend); // Filtrar resultados nulos
    } catch (error) {
      console.error('Erro ao listar amigos:', error);
      throw error;
    }
  }

  /**
   * Adiciona um amigo à lista de conexões do usuário.
   * @param userId ID do usuário logado.
   * @param friendId ID do amigo a ser adicionado.
   * @returns Promise resolvendo ao final da operação.
   */
  async addFriend(userId: string, friendId: string): Promise<void> {
    try {
      const friendDoc = doc(this.firestoreService.db, `amigos/${userId}_${friendId}`);
      await setDoc(friendDoc, { userId1: userId, userId2: friendId });
      console.log(`Amigo ${friendId} adicionado ao usuário ${userId}.`);
    } catch (error) {
      console.error('Erro ao adicionar amigo:', error);
      throw error;
    }
  }

  /**
   * Carrega amigos do usuário logado e atualiza a lista local.
   * @returns Promise resolvendo após carregar os amigos.
   */
  async loadFriends(): Promise<void> {
    const userUID = this.authService.getLoggedUserUID();
    if (userUID) {
      try {
        this.amigos = await this.listFriends(userUID);
        console.log('Amigos carregados com sucesso:', this.amigos);
      } catch (error) {
        console.error('Erro ao carregar amigos:', error);
      }
    } else {
      console.warn('Nenhum usuário autenticado encontrado.');
    }
  }
}
