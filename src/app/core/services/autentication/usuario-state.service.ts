//src\app\core\services\autentication\usuario-state.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, from } from 'rxjs';
import { IUserDados } from '../../interfaces/iuser-dados';
import { doc, onSnapshot } from '@firebase/firestore';
import { FirestoreService } from './firestore.service';
import { UserProfileService } from '../user-profile/user-profile.service';

@Injectable({
  providedIn: 'root'
})
export class UsuarioStateService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  public user$ = this.userSubject.asObservable();

  constructor(private firestoreService: FirestoreService,
              private userProfileService: UserProfileService) { }

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

  atualizarRoleUsuario(uid: string, novoRole: string) {
    return from(this.userProfileService.updateUserRole(uid, novoRole));
  }

  atualizarEstadoOnlineUsuario(uid: string, isOnline: boolean) {
    return from(this.userProfileService.updateUserOnlineStatus(uid, isOnline));
  }
}
