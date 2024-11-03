// src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, take, throwError } from 'rxjs';
import { IUserDados } from '../interfaces/iuser-dados';
import { FirestoreService } from './autentication/firestore.service';
import { collection, onSnapshot, query, Timestamp, where } from '@firebase/firestore';
import { User } from 'firebase/auth';
import { UserProfileService } from './user-profile/user-profile.service';
import { EmailVerificationService } from './autentication/email-verification.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectUserById } from 'src/app/store/selectors/selectors.user/user.selectors';
import { addUserToState } from 'src/app/store/actions/actions.user/user.actions';

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  constructor(
    private firestoreService: FirestoreService,
    private userProfileService: UserProfileService,
    private emailVerificationService: EmailVerificationService,
    private store: Store<AppState>
  ) { }

  // Método para mapear um usuário do Firebase (User) para o formato da interface IUserDados
  private mapUserToUserDados(user: User | null): IUserDados | null {
    if (!user) return null;

    const timestampNow = this.getCurrentTimestamp();

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: 'basico', // Padrão, ajustar conforme necessário
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
  private getCurrentTimestamp(): Timestamp {
    return Timestamp.fromDate(new Date());
  }

  // Atualiza o status online de um usuário no Firestore
  updateUserOnlineStatus(uid: string, isOnline: boolean): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { isOnline });
  }

  // Obtém usuários online por região específica (município)
  public getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    return this.firestoreService.getOnlineUsersByRegion(municipio);
  }

  // Obtém todos os usuários do Firestore
  getAllUsers(): Observable<IUserDados[]> {
    return from(this.firestoreService.getAllUsers()).pipe(
      map(users => {
        console.log('Usuários carregados do Firestore:', users);
        return users;
      }),
      catchError(error => {
        console.error('Erro ao buscar todos os usuários:', error);
        return of([]); // Retorna uma lista vazia em caso de erro
      })
    );
  }

  // Obtém um usuário específico pelo UID
  getUsuario(uid: string): Observable<IUserDados | null> {
    if (!uid) {
      console.warn(`UID inválido fornecido: ${uid}`);
      return of(null);
    }
    return this.store.select(selectUserById(uid)).pipe(
      take(1),
      switchMap(existingUser => {
        if (existingUser) {
          console.log('Usuário encontrado no estado:', existingUser);
          return of(existingUser);
        } else {
          console.log('Usuário não encontrado no estado, buscando no Firestore...');
          return from(this.userProfileService.getUserById(uid)).pipe(
            map(user => {
              if (user) {
                // Adiciona o usuário ao estado se ainda não existir
                this.store.dispatch(addUserToState({ user }));
                console.log('Usuário recuperado e adicionado ao estado:', user);
              }
              return user;
            }),
            catchError(error => {
              console.error('Erro ao buscar usuário no Firestore:', error);
              return of(null);
            })
          );
        }
      })
    );
  }


  // Atualiza o papel (role) de um usuário no Firestore
  updateUserRole(uid: string, newRole: string): Observable<void> {
    return from(this.userProfileService.updateUserRole(uid, newRole)).pipe(
      catchError((error) => {
        console.error('Erro ao atualizar role do usuário:', error);
        return throwError(() => error);
      })
    );
  }

  // Obtém todos os usuários online
  getAllOnlineUsers(): Observable<IUserDados[]> {
    const usersCollection = collection(this.firestoreService.db, 'users');
    const onlineUsersQuery = query(usersCollection, where('isOnline', '==', true));

    return new Observable<IUserDados[]>(observer => {
      const unsubscribe = onSnapshot(onlineUsersQuery, (snapshot) => {
        const users = snapshot.docs.map(doc => doc.data() as IUserDados);
        observer.next(users);
      }, (error) => {
        observer.error(error);
      });

      return () => unsubscribe(); // Certifique-se de parar de escutar quando o observable for descartado
    });
  }

  // Atualiza os dados de um usuário específico no Firestore
  atualizarUsuario(uid: string, dados: Partial<IUserDados>): Observable<void> {
    const isSubscriber = dados.role && dados.role !== 'free';
    const dadosAtualizados = { ...dados, isSubscriber };
    return from(
      this.emailVerificationService.saveUserDataAfterEmailVerification({ uid, ...dadosAtualizados } as IUserDados)
    ).pipe(
      catchError((error) => {
        console.error('Erro ao atualizar usuário:', error);
        throw error;
      })
    );
  }
}
