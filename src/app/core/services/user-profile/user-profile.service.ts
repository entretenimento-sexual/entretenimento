//src\app\core\services\user-profile\user-profile.service.ts
import { Injectable } from '@angular/core';
import { collection, doc, getDoc, updateDoc } from '@firebase/firestore';
import { FirestoreService } from '../autentication/firestore.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  constructor(private firestoreService: FirestoreService) { }

  /**
   * Obtém os dados do usuário por ID do Firestore.
   * Realiza tentativas de recuperação em caso de falha.
   *
   * @param uid O UID do usuário a ser recuperado.
   * @param retries Número de tentativas de recuperação (padrão: 2).
   * @returns Uma Promise que resolve com os dados do usuário ou null se não encontrado.
   */
  async getUserById(uid: string, retries: number = 2): Promise<IUserDados | null> {
    console.log('Método getUserById foi chamado com UID:', uid);

    if (!uid) {
      console.error('UID inválido fornecido.');
      return null;
    }

    const userRef = doc(this.firestoreService.db, 'users', uid);
    let attempt = 0;

    while (attempt <= retries) {
      const userSnapshot = await getDoc(userRef);
      if (userSnapshot.exists()) {
        console.log('Snapshot recuperado:', userSnapshot.data());
        return userSnapshot.data() as IUserDados;
      } else if (attempt < retries) {
        console.log(`Tentativa ${attempt + 1}: Nenhum usuário encontrado, tentando novamente...`);
        await this.delay(1000); // Espera um segundo antes de tentar novamente
      } else {
        console.log('Nenhum usuário encontrado com o uid:', uid);
        return null;
      }
      attempt++;
    }
    return null;
  }

  /**
   * Atualiza o estado online do usuário no Firestore.
   *
   * @param uid O UID do usuário a ser atualizado.
   * @param isOnline O novo estado online do usuário (true para online, false para offline).
   */
  async atualizarEstadoOnlineUsuario(uid: string, isOnline: boolean): Promise<void> {
    if (!uid) {
      console.warn('UID inválido fornecido ao tentar atualizar o estado online.');
      return;
    }

    console.log(`Atualizando estado online do usuário ${uid} para: ${isOnline}`);
    const userRef = doc(this.firestoreService.db, 'users', uid);

    try {
      await updateDoc(userRef, {
        isOnline: isOnline
      });
      console.log('Estado online atualizado com sucesso.');
    } catch (error) {
      console.error('Erro ao atualizar o estado online:', error);
    }
  }

  /**
   * Atualiza a localização do usuário no Firestore.
   *
   * @param uid O UID do usuário.
   * @param location Objeto com latitude e longitude.
   * @param geohash O geohash da localização.
   */
  async updateUserLocation(uid: string, location: GeoCoordinates, geohash: string): Promise<void> {
    if (!uid || !location) {
      throw new Error('UID do usuário ou localização inválidos');
    }

    const userRef = doc(this.firestoreService.db, 'users', uid);

    try {
      await updateDoc(userRef, {
        latitude: location.latitude,
        longitude: location.longitude,
        geohash: geohash
      });
      console.log('Localização do usuário atualizada com sucesso.');
    } catch (error) {
      console.error('Erro ao atualizar a localização do usuário:', error);
      throw error;
    }
  }

  /**
   * Atualiza o papel (role) do usuário no Firestore.
   *
   * @param uid O UID do usuário.
   * @param newRole O novo papel a ser atribuído ao usuário.
   */
  async updateUserRole(uid: string, newRole: string): Promise<void> {
    if (!uid || !newRole) {
      throw new Error('UID ou novo papel inválidos');
    }

    const userRef = doc(this.firestoreService.db, 'users', uid);

    try {
      await updateDoc(userRef, {
        role: newRole
      });
      console.log('Papel do usuário atualizado com sucesso.');
    } catch (error) {
      console.error('Erro ao atualizar o papel do usuário:', error);
      throw error;
    }
  }

  /**
   * Método auxiliar para aguardar um período de tempo antes de continuar a execução.
   *
   * @param ms O tempo de espera em milissegundos.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
