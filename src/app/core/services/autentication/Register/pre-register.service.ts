//src\app\core\services\autentication\Register\pre-register.service.ts
import { Injectable } from '@angular/core';
import { addDoc, collection } from '@firebase/firestore';
import { FirestoreService } from '../../data-handling/legacy/firestore.service';

@Injectable({
  providedIn: 'root'
})
export class PreRegisterServiceService {

  constructor(private firestoreService: FirestoreService) { }

  // Método simples para gerar um token (não tão robusto quanto UUID)
  private generateToken(): string {
    return Math.random().toString(36).substr(2) + Date.now().toString(36);
  }

  // Obter ou criar um token do localStorage
  getToken(): string {
    let token = localStorage.getItem('preRegisterToken');
    if (!token) {
      token = this.generateToken();
      localStorage.setItem('preRegisterToken', token);
    }
    return token;
  }

  // Método para coletar preferências do usuário antes do registro
  async saveUserPreferences(userPreferences: any): Promise<void> {
    const db = this.firestoreService.getFirestoreInstance();
    try {
      const token = this.getToken();
      const prefRef = collection(db, "preRegisterPreferences");
      const combinedData = { ...userPreferences, token };  // Combine userPreferences with token
      await addDoc(prefRef, combinedData);
      console.log('Preferências do usuário salvas no Firestore.');
    } catch (error) {
      console.log('Erro ao salvar preferências do usuário:', error);
      throw error;
    }
  }
}
