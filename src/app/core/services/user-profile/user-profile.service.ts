// Serviço para gerenciar o perfil do usuário, incluindo obtenção e atualização de dados.
// - Busca otimizada com cache
// - Atualizações refletidas no Firestore e Store
// - Métodos claros e documentados
// - Tratamento de erros básico
// - Observable-first para evitar Promises na API pública quando possível
// - Não esquecer os comentários explicativos.
// src/app/core/services/user-profile/user-profile.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { updateUserRole } from '../../../store/actions/actions.user/user-role.actions';
import { updateUserLocation } from '../../../store/actions/actions.location/location.actions';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';

import { doc, updateDoc } from '@angular/fire/firestore';
import { Observable, of, from, throwError, firstValueFrom } from 'rxjs';
import { catchError, tap, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  // Se você não usa cache aqui, melhor remover para evitar ruído.
  // private userCache: IUserDados | null = null;

  constructor(
    private firestoreQueryService: FirestoreQueryService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private store: Store<AppState>,
    private errorHandler: GlobalErrorHandlerService,
    private notifier: ErrorNotificationService
  ) { }

  /**
   * Obtém o perfil do usuário pelo UID.
   * - Observable-first
   * - Erro roteado e retorno null para não quebrar a UI (ajuste conforme sua UX)
   */
  getLoggedUserProfile(uid: string): Observable<IUserDados | null> {
    if (!uid) return of(null);

    return this.firestoreUserQuery.getUserWithObservable(uid).pipe(
      catchError((err) => {
        this.routeError(err, 'getLoggedUserProfile', 'Não foi possível carregar o perfil agora.');
        return of(null);
      })
    );
  }

  /**
   * Observable-first: atualiza role e sincroniza Store.
   */
  updateUserRole$(uid: string, newRole: string): Observable<void> {
    if (!uid || !newRole) {
      return throwError(() => new Error('[UserProfileService] UID ou novo papel inválido.'));
    }

    const fs = this.firestoreQueryService.getFirestoreInstance();

    return from(updateDoc(doc(fs, 'users', uid), { role: newRole })).pipe(
      tap(() => this.store.dispatch(updateUserRole({ uid, newRole }))),
      map(() => void 0),
      catchError((err) => {
        this.routeError(err, 'updateUserRole$', 'Não foi possível atualizar o papel do usuário.');
        return throwError(() => err);
      })
    );
  }


  /**
   * Mantido (compat): Promise wrapper do método Observable-first.
   * Mantém a nomenclatura pública usada no projeto sem te prender a Promises.
   */
  async updateUserRole(uid: string, newRole: string): Promise<void> {
    await firstValueFrom(this.updateUserRole$(uid, newRole));
  }


  // Observable-first: atualiza localização e sincroniza Store.
  updateUserLocation$(uid: string, location: GeoCoordinates, geohash: string): Observable<void> {
    if (!uid || !location) {
      return throwError(() => new Error('[UserProfileService] UID do usuário ou localização inválidos.'));
    }

    const fs = this.firestoreQueryService.getFirestoreInstance();

    return from(
      updateDoc(doc(fs, 'users', uid), {
        latitude: location.latitude,
        longitude: location.longitude,
        geohash,
      })
    ).pipe(
      tap(() => this.store.dispatch(updateUserLocation({ uid, location }))),
      map(() => void 0),
      catchError((err) => {
        this.routeError(err, 'updateUserLocation$', 'Não foi possível atualizar a localização agora.');
        return throwError(() => err);
      })
    );
  }

  /**
   * Mantido (compat): Promise wrapper do método Observable-first.
   */
  async updateUserLocation(uid: string, location: GeoCoordinates, geohash: string): Promise<void> {
    await firstValueFrom(this.updateUserLocation$(uid, location, geohash));
  }

  // ----------------------------------------------------
  // Erros centralizados
  // ----------------------------------------------------
  private routeError(err: unknown, context: string, userMessage?: string): void {
    const e = err instanceof Error ? err : new Error(`[UserProfileService] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;

    this.errorHandler.handleError(e);

    if (userMessage) {
      this.notifier.showError(userMessage);
    }
  }
} // Linha 132
