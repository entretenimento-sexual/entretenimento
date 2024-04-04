//src\app\core\services\user-profile\user-profile.service.ts
import { Injectable } from '@angular/core';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from '@firebase/firestore';
import { FirestoreService } from '../autentication/firestore.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {

  constructor(private firestoreService: FirestoreService) { }

  async getUserById(uid: string, retries: number = 2): Promise<IUserDados | null> {
    console.log('Método getUserById foi chamado com UID:', uid);
    const userRef = doc(this.firestoreService.db, 'users', uid);
    let attempt = 0;

    while (attempt <= retries) {
      const userSnapshot = await getDoc(userRef);
      if (userSnapshot.exists()) {
        console.log('Snapshot recuperado:', userSnapshot.data());
        return userSnapshot.data() as IUserDados;
      } else if (attempt < retries) {
        console.log(`Tentativa ${attempt + 1}: Nenhum usuário encontrado, tentando novamente...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Espera um segundo antes de tentar novamente
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
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, {
      isOnline: isOnline
    });
  }

   async updateUserLocation(uid: string, location: GeoCoordinates, geohash: string): Promise<void> {
    try {
      if (!uid || !location) {
        throw new Error('UID do usuário ou localização inválidos');
      }

      // Crie uma referência ao documento do usuário
      const userRef = doc(this.firestoreService.db, 'users', uid);

      // Atualize as coordenadas de latitude e longitude no documento do usuário
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

  async updateUserRole(uid: string, newRole: string): Promise<void> {
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, {
      role: newRole
    });
  }

  async updateUserOnlineStatus(uid: string, isOnline: boolean): Promise<void> {
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, {
      isOnline: isOnline
    });
  }
}
