//src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of } from 'rxjs';
import { IUserDados } from '../interfaces/iuser-dados';
import { FirestoreService } from './autentication/firestore.service';
import { collection, onSnapshot, query, Timestamp, where } from '@firebase/firestore';
import { User } from 'firebase/auth';
import { UserProfileService } from './user-profile/user-profile.service';

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  constructor(
    private firestoreService: FirestoreService,
    private userProfileService: UserProfileService,
  ) { }

  // Método para mapear um usuário do Firebase (User) para o formato da interface IUserDados
  // Útil quando você precisa converter dados do Firebase para seu formato de dados interno.
  private mapUserToUserDados(user: User | null): IUserDados | null {
    if (!user) return null;

    const timestampNow = this.getCurrentTimestamp();

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: 'basico',
      lastLoginDate: timestampNow,
      firstLogin: timestampNow,
      descricao: '',
      facebook: '',
      instagram: '',
      buupe: '',
      isSubscriber: false,
    };
  }

  // Método auxiliar para obter o timestamp atual
  // Utilizado internamente para definir os campos de data/hora.
  private getCurrentTimestamp(): Timestamp {
    return Timestamp.fromDate(new Date());
  }

  // Atualiza o status online de um usuário no Firestore
  // Necessário se você estiver gerenciando a presença online de usuários.
  updateUserOnlineStatus(uid: string, isOnline: boolean): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { isOnline });
  }

  // Obtém usuários online por região específica (município)
  // Essencial para filtrar usuários com base na localização.
  public getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    return this.firestoreService.getOnlineUsersByRegion(municipio);
  }

  // Obtém todos os usuários do Firestore
  // Útil se você precisar carregar a lista completa de usuários.
  getAllUsers(): Observable<IUserDados[]> {
    return from(this.firestoreService.getAllUsers()).pipe(
      map(users => {
        console.log('Usuários carregados do Firestore:', users);
        return users;
      }),
      catchError(error => {
        console.error('Erro ao buscar todos os usuários:', error);
        return of([]);  // Retorna uma lista vazia em caso de erro
      })
    );
  }

  // Obtém um usuário específico pelo UID
  // Necessário para carregar os detalhes de um usuário específico.
  getUsuario(uid: string): Observable<IUserDados | null> {
    return from(this.userProfileService.getUserById(uid)).pipe(
      map(user => user as IUserDados | null),
      catchError((error) => {
        console.error('Erro ao buscar usuário:', error);
        return of(null);
      })
    );
  }

  // Atualiza os dados de um usuário específico no Firestore
  // Importante para gerenciar atualizações de perfis de usuários.
  atualizarUsuario(uid: string, dados: Partial<IUserDados>): Observable<void> {
    const isSubscriber = dados.role && dados.role !== 'free';
    const dadosAtualizados = { ...dados, isSubscriber };
    return from(
      this.firestoreService.saveUserDataAfterEmailVerification({ uid, ...dadosAtualizados } as IUserDados)
    ).pipe(
      catchError((error) => {
        console.error('Erro ao atualizar usuário:', error);
        throw error;
      })
    );
  }

  getAllOnlineUsers(): Observable<IUserDados[]> {
    return this.firestoreService.getAllOnlineUsers(); // Usa o FirestoreService para obter os usuários online
  }
}

