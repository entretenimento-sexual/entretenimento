// src\app\core\services\preferences\user-preferences.service.ts
import { Injectable } from '@angular/core';
import { collection, doc, getDocs, query, setDoc, where } from '@firebase/firestore';
import { IUserPreferences } from '../../interfaces/iuser-preferences';
import { FirestoreService } from '../data-handling/firestore.service';
import { Observable, from } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserPreferencesService {

  constructor(private firestoreService: FirestoreService) { }

  async saveUserPreferences(uid: string, preferences: any): Promise<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const userRef = doc(db, `users/${uid}`);
    const preferencesCollection = collection(userRef, 'preferences');

    for (const [category, preferenceData] of Object.entries(preferences)) {
      const prefDocRef = doc(preferencesCollection, category);
      await setDoc(prefDocRef, preferenceData);
    }
  }

  async getUserPreferences(uid: string): Promise<IUserPreferences> {
    const db = this.firestoreService.getFirestoreInstance();
    const preferencesCollectionRef = collection(db, `users/${uid}/preferences`);
    const querySnapshot = await getDocs(preferencesCollectionRef);

    const preferences: IUserPreferences = {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: []
    };

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      preferences[doc.id] = data['value'];
    });

    return preferences;
  }

  async getUserPreferencesByToken(token: string): Promise<any | null> {
    const db = this.firestoreService.getFirestoreInstance();
    console.log("Entrando em getUserPreferencesByToken com o token:", token);

    const preRegisterCollection = collection(db, "preRegisterPreferences");
    const preRegisterQuery = query(preRegisterCollection, where("token", "==", token));
    const userSnapshots = await getDocs(preRegisterQuery);

    if (userSnapshots.empty) {
      console.log(`Nenhuma preferência encontrada para o token: ${token}`);
      return null;
    }
    return userSnapshots.docs[0].data();
  }

  salvarPreferenciasDoUsuario(uid: string, preferencias: any): Observable<void> {
    return from(this.saveUserPreferences(uid, preferencias));
  }

  buscarPreferenciasDoUsuario(uid: string): Observable<any | null> {
    return from(this.getUserPreferences(uid));
  }
}
