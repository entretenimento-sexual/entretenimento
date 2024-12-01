// src/app/core/services/user-profile/user-profile.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { updateUserRole } from '../../../store/actions/actions.user/user-role.actions';
import { updateUserLocation } from '../../../store/actions/actions.location/location.actions';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';
import { doc, updateDoc } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  private userCache: IUserDados | null = null;

  constructor(
    private firestoreQueryService: FirestoreQueryService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private store: Store<AppState>
  ) { }

  /**
   * Obtém o perfil do usuário logado pelo UID, verificando primeiro no cache e, se não encontrado, busca no Firestore.
   *
   * @param uid O UID do usuário logado.
   * @returns Uma Promise que resolve com os dados do usuário ou null se não encontrado.
   */
  getLoggedUserProfile(uid: string): Observable<IUserDados | null> {
    console.log('Método getLoggedUserProfile foi chamado.');

    if (!uid) {
      console.error('UID inválido fornecido.');
      return of(null);
    }

    return this.firestoreUserQuery.getUserWithObservable(uid);
  }

  async updateUserRole(uid: string, newRole: string): Promise<void> {
    console.log(`Atualizando papel do usuário ${uid} para: ${newRole}`);

    if (!uid || !newRole) {
      console.error('UID ou novo papel inválido.');
      throw new Error('UID ou novo papel inválido');
    }

    try {
      await updateDoc(doc(this.firestoreQueryService.getFirestoreInstance(), 'users', uid), { role: newRole });
      console.log('Papel do usuário atualizado com sucesso no Firestore.');
      this.store.dispatch(updateUserRole({ uid, newRole }));
    } catch (error) {
      console.error('Erro ao atualizar o papel do usuário:', error);
      throw error;
    }
  }


  async updateUserLocation(uid: string, location: GeoCoordinates, geohash: string): Promise<void> {
    console.log(`Atualizando localização do usuário ${uid} para latitude: ${location.latitude}, longitude: ${location.longitude}`);

    if (!uid || !location) {
      console.error('UID do usuário ou localização inválidos.');
      throw new Error('UID do usuário ou localização inválidos');
    }

    try {
      await updateDoc(doc(this.firestoreQueryService.getFirestoreInstance(), 'users', uid), {
        latitude: location.latitude,
        longitude: location.longitude,
        geohash: geohash
      });
      console.log('Localização do usuário atualizada com sucesso no Firestore.');
      this.store.dispatch(updateUserLocation({ uid, location }));
    } catch (error) {
      console.error('Erro ao atualizar a localização do usuário:', error);
      throw error;
    }
  }
}
