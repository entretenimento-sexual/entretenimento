//src\app\core\services\autentication\usuario-state.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, from } from 'rxjs';
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
      const userData = docSnapshot.data() as IUserDados;
      // Aqui, você pode implementar lógica adicional se necessário
      // Por exemplo, verificar a validade da assinatura antes de definir isSubscriber
      this.setUser(userData);
    });
  }

  public fetchAllUsers() {
    const usersRef = collection(this.firestoreService.db, "users");
    onSnapshot(usersRef, (querySnapshot) => {
      const users: IUserDados[] = [];
      querySnapshot.forEach((doc) => {
        const userData = doc.data() as IUserDados;
        if (userData.isOnline) {
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
}
