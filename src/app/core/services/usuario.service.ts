// src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of } from 'rxjs';
import { IUserDados } from '../interfaces/iuser-dados';
import { FirestoreService } from './autentication/firestore.service';
import { Timestamp } from '@firebase/firestore';
import { User } from 'firebase/auth';
import { UserPreferencesService } from './preferences/user-preferences.service';
import { UserProfileService } from './user-profile/user-profile.service';

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  constructor(private firestoreService: FirestoreService,
              private userProfileService: UserProfileService,
              private userPreferencesService: UserPreferencesService) { }

  // Mapeia o usuário do Firebase para o formato IUserDados
  private mapUserToUserDados(user: User | null): IUserDados | null {
    if (!user) return null;

    const now = new Date();
    const timestampNow = Timestamp.fromDate(now);

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: 'basico',
      lastLoginDate: timestampNow,
      firstLogin: timestampNow,
      descricao: '',   // Valor padrão ou nulo
      facebook: '',    // Valor padrão ou nulo
      instagram: '',   // Valor padrão ou nulo
      buupe: '',
      isSubscriber: false,
    };
  }

  getUsuario(uid: string): Observable<IUserDados | null> {
    return from(this.userProfileService.getUserById(uid)).pipe(
      map(user=> user as IUserDados | null),
      catchError(() => of(null)) // Retorna null em caso de erro
    );
  }

  atualizarUsuario(uid: string, dados: Partial<IUserDados>): Observable<void> {
    const isSubscriber = dados.role && dados.role !== 'free';
    const dadosAtualizados = { ...dados, isSubscriber };
    return from(this.firestoreService.saveUserDataAfterEmailVerification({ uid, ...dadosAtualizados } as IUserDados));
  }
}
