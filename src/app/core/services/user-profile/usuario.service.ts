// src\app\core\services\usuario.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, tap, throwError } from 'rxjs';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreService } from '../data-handling/firestore.service';
import { doc, getDoc, Timestamp, updateDoc } from '@firebase/firestore';
import { User } from 'firebase/auth';
import { UserProfileService } from './user-profile.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { updateUserOnlineStatus } from 'src/app/store/actions/actions.user/user.actions';
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
  private mapUserToUserDados(user: User | null): IUserDados | null {
    if (!user) return null;

    const timestampNow = this.getCurrentTimestamp();

    return {
      uid: user.uid,
      email: user.email,
      nickname: null,
      photoURL: user.photoURL || null,
      role: 'basic',
      lastLogin: timestampNow,
      firstLogin: timestampNow,
      descricao: '',
      isSubscriber: false,
      socialLinks: {
        facebook: '',
        instagram: '',
        buupe: ''
      }

    };
  }

  // Método auxiliar para obter o timestamp atual
  private getCurrentTimestamp(): Timestamp {
    return Timestamp.fromDate(new Date());
  }

  // Obtém usuários online por região específica (município)
  public getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    return this.firestoreQuery.getOnlineUsersByRegion(municipio);
  }

  // Atualiza o status online de um usuário no Firestore e no Store
  updateUserOnlineStatus(uid: string, isOnline: boolean): Observable<void> {
    const userDocRef = doc(this.afs, 'users', uid);
    return from(updateDoc(userDocRef, { isOnline })).pipe(
      tap(() => {
        console.log(`[UsuarioService] isOnline → ${isOnline} (${uid})`);
        this.store.dispatch(updateUserOnlineStatus({ uid, isOnline }));
      }),
      catchError((error) => {
        console.error('[UsuarioService] erro ao atualizar isOnline:', error);
        return throwError(() => error);
      })
    );
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

  async updateUserRoomIds(userId: string, roomId: string, action: 'add' | 'remove'): Promise<void> {
    const userRef = doc(this.firestoreQuery.getFirestoreInstance(), 'users', userId);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
      const userData = userDoc.data();
      const roomIds = userData['roomIds'] || [];

      if (action === 'add') {
        if (!roomIds.includes(roomId)) {
          roomIds.push(roomId);
        }
      } else if (action === 'remove') {
        const index = roomIds.indexOf(roomId);
        if (index > -1) {
          roomIds.splice(index, 1);
        }
      }

      await updateDoc(userRef, { roomIds });
    }
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
}
