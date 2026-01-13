// src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, of, throwError } from 'rxjs';
import { IUserDados } from '../../interfaces/iuser-dados';
import { User } from 'firebase/auth';
import { UserProfileService } from './user-profile.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { EmailVerificationService } from '../autentication/register/email-verification.service';
import { Firestore } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})

export class UsuarioService {

  constructor(private afs: Firestore,
              private firestoreQuery: FirestoreQueryService,
              private userProfile: UserProfileService,
              private emailVerificationService: EmailVerificationService,
              private store: Store<AppState>) { }

  // Método para mapear um usuário do Firebase (User) para o formato da interface IUserDados
  private mapUserToUserDados(user: User | null): IUserDados | null {//está esmaecido
    if (!user) return null;

    const now = Date.now();

    return {
      uid: user.uid,
      email: user.email,
      nickname: null,
      photoURL: user.photoURL || null,
      role: 'basic',
      lastLogin: now,
      firstLogin: now,
      descricao: '',
      isSubscriber: false,
      socialLinks: {
        facebook: '',
        instagram: '',
        buupe: ''
      }

    };
  }

  // Obtém usuários online por região específica (município)
  public getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    return this.firestoreQuery.getOnlineUsersByRegion(municipio);
  }

  /**
 * @deprecated Presença é controlada exclusivamente por PresenceService (AuthOrchestratorService).
 * Remover usos e confiar no pipeline de presença.
 */
  updateUserOnlineStatus(_uid: string, _isOnline: boolean, _syncStore = true): Observable<void> {
    // Não escrever em Firestore aqui — writer único é PresenceService.
    return of(void 0);
  }

  // Atualiza o papel (role) de um usuário no Firestore
  updateUserRole(uid: string, newRole: string): Observable<void> {
    return from(this.userProfile.updateUserRole(uid, newRole)).pipe(
      catchError((error) => {
        console.log('Erro ao atualizar role do usuário:', error);
        return throwError(() => error);
      })
    );
  }

  // Atualiza os dados de um usuário específico no Firestore
  atualizarUsuario(uid: string, dados: Partial<IUserDados>): Observable<void> {
    const isSubscriber = dados.role && dados.role !== 'free' ? true : false;
    const dadosAtualizados = { ...dados, isSubscriber };
    return from(
      this.emailVerificationService.saveUserDataAfterEmailVerification({ uid, ...dadosAtualizados } as IUserDados)
    ).pipe(
      catchError((error) => {
        console.log('Erro ao atualizar usuário:', error);
        throw error;
      })
    );
  }
}//Linha122
/* O que ele não deveria fazer

❌ Presença(isOnline / lastSeen) → isso é 100 % PresenceService.
❌ Query de online users → isso é UserPresenceQueryService.
❌ Gerenciar vínculos de chat(roomIds) → isso é chat - domain.
❌ Depender do EmailVerificationService para update genérico → acoplamento perigoso.
Com ideia de descontinuar esse service*/
