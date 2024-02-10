//src\app\core\services\preferences\user-preferences.service.ts
import { Injectable } from '@angular/core';
import { collection, doc, getDocs, query, setDoc, where } from '@firebase/firestore';
import { IUserPreferences } from '../../interfaces/iuser-preferences';
import { FirestoreService } from '../autentication/firestore.service';
import { Observable, from } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserPreferencesService {

  constructor(private firestoreService: FirestoreService) { }

  async saveUserPreferences(uid: string, preferences: any): Promise<void> {
    const userRef = doc(this.firestoreService.db, `users/${uid}`);
    const preferencesCollection = collection(userRef, 'preferences');

    for (const [category, preferenceData] of Object.entries(preferences)) {
      const prefDocRef = doc(preferencesCollection, category);
      await setDoc(prefDocRef, preferenceData);
    }
  }

  async getUserPreferencesByToken(token: string): Promise<any | null> {
    console.log("Entrando em getUserPreferencesByToken com o token:", token);

    const preRegisterCollection = collection(this.firestoreService.db, "preRegisterPreferences");
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
    return from(this.firestoreService.getUserPreferences(uid));
  }
}


