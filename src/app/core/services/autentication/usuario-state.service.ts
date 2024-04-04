//src\app\core\services\autentication\usuario-state.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, map } from 'rxjs';
import { IUserDados } from '../../interfaces/iuser-dados';
import { collection, doc, onSnapshot } from '@firebase/firestore';
import { FirestoreService } from './firestore.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})

export class UsuarioStateService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  public user$ = this.userSubject.asObservable();

  private allUsersSubject = new BehaviorSubject<IUserDados[]>([]);
  public allUsers$ = this.allUsersSubject.asObservable();
  isLoading: any;

  constructor(private firestoreService: FirestoreService,
              private userProfileService: UserProfileService,
              private authService: AuthService) {
    this.initializeUserStateListener();
               }

  private initializeUserStateListener() {
    // Inscreve-se no observable user$ do AuthService para reagir às mudanças do usuário autenticado
    this.authService.user$.subscribe(user => {
      if (user) {
        // Se um usuário estiver autenticado, você pode realizar lógicas adicionais aqui
        // Por exemplo, chamar outros métodos baseados no usuário autenticado
        console.log('Usuário autenticado:', user);
        this.setUser(user);
        // Talvez atualizar a presença online, ou outras lógicas específicas
        this.atualizarEstadoOnlineUsuario(user.uid, true);
      } else {
        // Usuário deslogado, realizar lógicas de limpeza se necessário
        console.log('Nenhum usuário autenticado');
        this.setUser(null);
      }
    });
  }

  setUser(user: IUserDados | null) {
    this.userSubject.next(user);
  }

  observarMudancasDoUsuario(uid: string) {
    const userRef = doc(this.firestoreService.db, "users", uid);
    onSnapshot(userRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const userData = docSnapshot.data() as IUserDados;
        this.userSubject.next(userData);
      } else {
        // Trate o caso de o documento do usuário não existir, se necessário.
        this.userSubject.next(null);
      }
    }, error => {
      console.error("Erro ao observar mudanças do usuário:", error);
      // Trate erros de observação aqui.
    });
  }

  public fetchAllUsers() {
    console.log('Buscando todos os usuários...');
    const usersRef = collection(this.firestoreService.db, "users");
    onSnapshot(usersRef, (querySnapshot) => {
      console.log('Recebido snapshot de todos os usuários.');
      const users: IUserDados[] = [];
      querySnapshot.forEach((doc) => {
        const userData = doc.data() as IUserDados;
        if (userData.isOnline) {
          console.log('Usuário online detectado:', userData);
          users.push(userData);
        }
      });
      this.allUsersSubject.next(users);
    });
  }

  atualizarRoleUsuario(uid: string, novoRole: string) {
    return from(this.userProfileService.updateUserRole(uid, novoRole));
  }

  atualizarEstadoOnlineUsuario(uid: string, isOnline: boolean) {
    return from(this.userProfileService.updateUserOnlineStatus(uid, isOnline));
  }

  temAcessoBasico(): Observable<boolean> {
    return this.user$.pipe(
      map(user => !!user && ['basico', 'premium', 'vip'].includes(user.role))
    );
  }

  // Verifica se o usuário tem acesso ao conteúdo premium
  temAcessoPremium(): Observable<boolean> {
    return this.user$.pipe(
      map(user => !!user && ['premium', 'vip'].includes(user.role))
    );
  }

  // Verifica se o usuário tem acesso ao conteúdo VIP
  temAcessoVip(): Observable<boolean> {
    return this.user$.pipe(
      map(user => !!user && user.role === 'vip')
    );
  }
}
