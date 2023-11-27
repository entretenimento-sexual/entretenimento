// src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, map } from 'rxjs';
import { IUserDados } from '../interfaces/iuser-dados';
import { FirestoreService } from './autentication/firestore.service';

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  constructor(private firestoreService: FirestoreService) { }

  getUsuario(uid: string): Observable<IUserDados | null> {
    return from(this.firestoreService.getUserById(uid)).pipe(
      map(user=> user as IUserDados | null)
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
