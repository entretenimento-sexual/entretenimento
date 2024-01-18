// src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of } from 'rxjs';
import { IUserDados } from '../interfaces/iuser-dados';
import { FirestoreService } from './autentication/firestore.service';
import { Timestamp } from '@firebase/firestore';
import { User } from 'firebase/auth';

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  constructor(private firestoreService: FirestoreService) { }

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
      role: 'animando',
      lastLoginDate: timestampNow,
      firstLogin: timestampNow,
      descricao: '',   // Valor padrão ou nulo
      facebook: '',    // Valor padrão ou nulo
      instagram: '',   // Valor padrão ou nulo
      buupe: '',
    };
  }

  getUsuario(uid: string): Observable<IUserDados | null> {
    return from(this.firestoreService.getUserById(uid)).pipe(
      map(user=> user as IUserDados | null),
      catchError(() => of(null)) // Retorna null em caso de erro
    );
  }

  atualizarUsuario(uid: string, dados: Partial<IUserDados>): Observable<void> {
    return from(this.firestoreService.saveUserDataAfterEmailVerification({ uid, ...dados } as IUserDados));
  }

  salvarPreferenciasDoUsuario(uid: string, preferencias: any): Observable<void> {
    return from(this.firestoreService.saveUserPreferences(uid, preferencias));
  }

  buscarPreferenciasDoUsuario(uid: string): Observable<any | null> {
    return from(this.firestoreService.getUserPreferences(uid));
  }
}
