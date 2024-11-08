//src\app\core\services\user-profile\user-profile.service.ts
import { Injectable } from '@angular/core';
import { doc, getDoc, updateDoc } from '@firebase/firestore';
import { FirestoreService } from '../autentication/firestore.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { updateUserRole } from 'src/app/store/actions/actions.user/user-role.actions'
import { updateUserLocation } from 'src/app/store/actions/actions.location/location.actions'
import { addUserToState, updateUserOnlineStatus } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileData } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  constructor(
    private firestoreService: FirestoreService,
    private store: Store<AppState>
  ) { }

  /**
   * Obtém os dados do usuário por ID do Firestore ou do Store se já estiver disponível.
   * Usa NgRx para evitar buscas duplicadas e melhorar a performance e reatividade.
   *
   * @param uid O UID do usuário a ser recuperado.
   * @returns Uma Promise que resolve com os dados do usuário ou null se não encontrado.
   */
  async getUserById(uid: string): Promise<IUserDados | null> {
    console.log('Método getUserById foi chamado com UID:', uid);

    if (!uid) {
      console.error('UID inválido fornecido.');
      return null;
    }

    // Verifica o store para ver se o usuário já está no estado
    const userFromStore = await firstValueFrom(this.store.select(selectUserProfileData));
    if (userFromStore?.uid === uid) {
      console.log('Usuário encontrado no estado:', userFromStore);
      return userFromStore as IUserDados;
    }

    // Caso o usuário não esteja no estado, busca no Firestore
    const userRef = doc(this.firestoreService.db, 'users', uid);
    try {
      const userSnapshot = await getDoc(userRef);
      if (userSnapshot.exists()) {
        const userData = userSnapshot.data() as IUserDados;
        console.log('Usuário recuperado do Firestore:', userData);
        this.store.dispatch(addUserToState({ user: userData })); // Adiciona ao store
        return userData;
      } else {
        console.warn(`Nenhum usuário encontrado com o UID: ${uid}`);
        return null;
      }
    } catch (error) {
      console.error('Erro ao recuperar dados do usuário:', error);
      throw error;
    }
  }

  /**
   * Atualiza o estado online do usuário no Firestore e no Store.
   * Usa o Store para manter o estado em sincronia com o Firestore.
   *
   * @param uid O UID do usuário a ser atualizado.
   * @param isOnline O novo estado online do usuário.
   */
  async atualizarEstadoOnlineUsuario(uid: string, isOnline: boolean): Promise<void> {
    console.log(`Atualizando estado online do usuário ${uid} para: ${isOnline}`);

    try {
      const userRef = doc(this.firestoreService.db, "users", uid);
      await updateDoc(userRef, { isOnline });
      console.log('Estado online atualizado com sucesso no Firestore.');
      this.store.dispatch(updateUserOnlineStatus({ uid, isOnline }));
    } catch (error) {
      console.error('Erro ao atualizar o estado online do usuário:', error);
      throw error;
    }
  }

  /**
   * Atualiza a localização do usuário no Firestore e no Store.
   *
   * @param uid O UID do usuário.
   * @param location Objeto com latitude e longitude.
   * @param geohash O geohash da localização.
   */
  async updateUserLocation(uid: string, location: GeoCoordinates, geohash: string): Promise<void> {
    console.log(`Atualizando localização do usuário ${uid} para latitude: ${location.latitude}, longitude: ${location.longitude}`);

    if (!uid || !location) {
      console.error('UID do usuário ou localização inválidos.');
      throw new Error('UID do usuário ou localização inválidos');
    }

    try {
      const userRef = doc(this.firestoreService.db, 'users', uid);
      await updateDoc(userRef, {
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

  /**
   * Atualiza o papel do usuário no Firestore e no Store.
   *
   * @param uid O UID do usuário.
   * @param newRole O novo papel a ser atribuído ao usuário.
   */
  async updateUserRole(uid: string, newRole: string): Promise<void> {
    console.log(`Atualizando papel do usuário ${uid} para: ${newRole}`);

    if (!uid || !newRole) {
      console.error('UID ou novo papel inválido.');
      throw new Error('UID ou novo papel inválido');
    }

    try {
      const userRef = doc(this.firestoreService.db, 'users', uid);
      await updateDoc(userRef, { role: newRole });
      console.log('Papel do usuário atualizado com sucesso no Firestore.');
      this.store.dispatch(updateUserRole({ uid, newRole }));
    } catch (error) {
      console.error('Erro ao atualizar o papel do usuário:', error);
      throw error;
    }
  }
}
