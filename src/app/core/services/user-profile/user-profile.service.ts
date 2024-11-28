// src\app\core\services\user-profile\user-profile.service.ts
import { Injectable } from '@angular/core';
import { doc, getDoc, onSnapshot, updateDoc } from '@firebase/firestore';
import { FirestoreService } from '../autentication/firestore.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { updateUserRole } from 'src/app/store/actions/actions.user/user-role.actions';
import { updateUserLocation } from 'src/app/store/actions/actions.location/location.actions';
import { addUserToState, updateUserOnlineStatus } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { firstValueFrom, Observable, of } from 'rxjs';
import { filter, take, tap, switchMap } from 'rxjs/operators';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  private userCache: Map<string, IUserDados> = new Map();

  constructor(
    private firestoreService: FirestoreService,
    private store: Store<AppState>
  ) { }

  /**
  * Obtém o usuário do Store pelo UID, se disponível.
  *
  * @param uid O UID do usuário.
  * @returns Um Observable que emite os dados do usuário ou null se não encontrado.
  */
  getUserFromState(uid: string): Observable<IUserDados | null> {
    if (!uid || typeof uid !== 'string' || uid.trim() === '') {
      console.log('UID inválido fornecido para getUserFromState.');
      return of(null);
    }

    const normalizedUid = uid.trim();

    if (this.userCache.has(normalizedUid)) {
      return of(this.userCache.get(normalizedUid) as IUserDados);
    }

    return this.store.select(selectUserProfileDataByUid(normalizedUid)).pipe(
      tap(user => {
        if (user) {
          this.userCache.set(normalizedUid, user);
        }
      }),
      switchMap(user => {
        if (!user) {
          return this.fetchAndAddUserToStore(normalizedUid).then(userData => {
            if (userData) {
              console.log('Usuário adicionado ao Store após busca no Firestore.');
              return userData;
            } else {
              console.log('Usuário não encontrado no Firestore.');
              return null;
            }
          });
        }
        return of(user);
      })
    );
  }

  /**
   * Obtém o usuário pelo UID, primeiro verificando no Store e, se não encontrado, busca no Firestore.
   *
   * @param uid O UID do usuário.
   * @returns Uma Promise que resolve com os dados do usuário ou null se não encontrado.
   */
  async getUserById(uid: string): Promise<IUserDados | null> {
    console.log('Método getUserById foi chamado.');

    if (!uid) {
      console.error('UID inválido fornecido.');
      return null;
    }

    const normalizedUid = uid.trim();

    try {
      const userFromStore = await firstValueFrom(
        this.store.select(selectUserProfileDataByUid(normalizedUid)).pipe(take(1))
      );

      if (userFromStore) {
        this.userCache.set(normalizedUid, userFromStore);
        return userFromStore;
      }
    } catch (error) {
      console.error('Erro ao buscar usuário no estado.');
    }

    return this.fetchAndAddUserToStore(normalizedUid);
  }

  /**
   * Busca o usuário no Firestore e o adiciona ao Store se encontrado.
   *
   * @param uid O UID do usuário.
   * @returns Uma Promise que resolve com os dados do usuário ou null se não encontrado.
   */
  private async fetchAndAddUserToStore(uid: string): Promise<IUserDados | null> {
    // Adiciona um log para garantir que o UID está sendo recebido corretamente
    console.log(`fetchAndAddUserToStore chamado com UID: ${uid}`);

    // if (this.userCache.has(uid)) {
//     console.log('Usuário encontrado no cache.');
//     return this.userCache.get(uid) || null;
// }

    // Referência ao documento do Firestore
    const userRef = doc(this.firestoreService.db, 'users', uid);
    try {
      // Tenta obter o documento do Firestore
      const userSnapshot = await getDoc(userRef);
      if (userSnapshot.exists()) {
        // Documento encontrado - adiciona ao estado
        const userData = userSnapshot.data() as IUserDados;

        if (userData) {
          console.log('Usuário encontrado no Firestore:', userData);
          // Despacha a ação para adicionar o usuário ao Store
          this.store.dispatch(addUserToState({ user: userData }));
          // Armazena o usuário no cache local
          this.userCache.set(uid, userData);
          return userData;
        } else {
          console.error('Dados do usuário são inválidos ou vazios:', userData);
        }
      } else {
        console.log(`Nenhum documento encontrado no Firestore para o UID: ${uid}`);
      }
    } catch (error) {
      console.error('Erro ao recuperar dados do usuário:', error);
    }
    console.log('Nenhum usuário encontrado com o UID no Firestore.');
    return null;
  }


  /**
   * Atualiza o estado online do usuário no Firestore e no Store.
   *
   * @param uid O UID do usuário a ser atualizado.
   * @param isOnline O novo estado online do usuário.
   */
  async atualizarEstadoOnlineUsuario(uid: string, isOnline: boolean): Promise<void> {
    console.log(`Atualizando estado online do usuário para: ${isOnline}`);

    try {
      const userRef = doc(this.firestoreService.db, "users", uid);
      await updateDoc(userRef, { isOnline });
      console.log('Estado online atualizado com sucesso no Firestore.');
      this.store.dispatch(updateUserOnlineStatus({ uid, isOnline }));
      this.userCache.set(uid, { ...this.userCache.get(uid), isOnline } as IUserDados); // Atualiza o cache
    } catch (error) {
      console.error('Erro ao atualizar o estado online do usuário.');
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
    console.log('Atualizando localização do usuário.');

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
      this.userCache.set(uid, { ...this.userCache.get(uid), latitude: location.latitude, longitude: location.longitude, geohash } as IUserDados); // Atualiza o cache
    } catch (error) {
      console.error('Erro ao atualizar a localização do usuário.');
      throw error;
    }
  }

  /**
  * Atualiza o papel do usuário no Firestore e no Store e monitora mudanças em tempo real.
  *
  * @param uid O UID do usuário.
  * @param newRole O novo papel a ser atribuído ao usuário.
  */
  async updateUserRole(uid: string, newRole: string): Promise<void> {
    console.log('Atualizando papel do usuário.');

    if (!uid || !newRole) {
      console.error('UID ou novo papel inválido.');
      throw new Error('UID ou novo papel inválido');
    }

    try {
      const userRef = doc(this.firestoreService.db, 'users', uid);

      // Atualiza o papel do usuário no Firestore
      await updateDoc(userRef, { role: newRole });
      console.log('Papel do usuário atualizado com sucesso no Firestore.');

      // Atualiza o Store com o novo papel
      this.store.dispatch(updateUserRole({ uid, newRole }));
      this.userCache.set(uid, { ...this.userCache.get(uid), role: newRole } as IUserDados); // Atualiza o cache

      // Adiciona monitoramento em tempo real para mudanças futuras no papel
      this.monitorUserRole(uid);
    } catch (error) {
      console.error('Erro ao atualizar o papel do usuário.');
      throw error;
    }
  }

  /**
   * Monitora mudanças em tempo real no `role` do usuário.
   * @param uid UID do usuário.
   */
  public monitorUserRole(uid: string): void {
    const userDocRef = doc(this.firestoreService.db, 'users', uid);

    onSnapshot(userDocRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const updatedRole = docSnapshot.data()?.['role'];
        console.log('Mudança em tempo real detectada no papel do usuário.');

        // Atualiza o Store com o papel atualizado
        this.store.dispatch(updateUserRole({ uid, newRole: updatedRole }));
        this.userCache.set(uid, { ...this.userCache.get(uid), role: updatedRole } as IUserDados); // Atualiza o cache
      } else {
        console.log('Documento do usuário não encontrado.');
      }
    }, (error) => {
      console.error('Erro ao monitorar mudanças no role do usuário.');
    });
  }

  /**
   * Limpa o cache de usuários. Pode ser utilizado após uma atualização significativa.
   */
  public clearUserCache(): void {
    this.userCache.clear();
    console.log('Cache de usuários limpo.');
  }

  /**
   * Esqueleto para futuros métodos necessários para expansão:
   * 1. **Monitoramento de Localização em Tempo Real** - Atualiza a localização de usuários em tempo real para funcionalidades baseadas em proximidade.
   * 2. **Gerenciamento de Preferências do Usuário** - Salvar e recuperar preferências de conteúdo e notificações do usuário.
   * 3. **Integração com Funções Sociais** - Métodos para interação entre usuários, como seguir, bloquear e enviar mensagens.
   * 4. **Gerenciamento de Sessões** - Monitorar e gerenciar multiplas sessões do usuário (ex.: usuário logado em diferentes dispositivos).
   */
}
