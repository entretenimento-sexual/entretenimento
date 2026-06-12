// src/app/core/services/autentication/Register/pre-register.service.ts
// Serviço responsável pelo rascunho de preferências antes do cadastro final.
//
// AJUSTES DESTA VERSÃO:
// - SUPRIMIDO anteriormente o uso do FirestoreService legado
// - este service passa a ser o DONO da coleção preRegisterPreferences
// - absorvida a leitura por token, antes espalhada em outro service
// - mantida a API pública atual de saveUserPreferences() para não quebrar o ProgressiveSignupComponent
//
// OBSERVAÇÃO IMPORTANTE:
// - este arquivo ainda pode ser renomeado no futuro para algo mais claro
// - por ora, o foco é centralizar a responsabilidade e reduzir duplicação
//
// SUPRESSÕES EXPLÍCITAS NESTA ETAPA:
// 1) A leitura de preRegisterPreferences não deve mais ficar no UserPreferencesService.
//    Motivo: essa coleção pertence ao fluxo anônimo/pré-registro.
// 2) Mantido o token via localStorage por compatibilidade imediata.
//    Motivo: evitar quebrar o fluxo atual antes de revisar a estratégia completa.
// 3) Mantido saveUserPreferences(...) com Promise<void>.
//    Motivo: o ProgressiveSignupComponent já consome esse método com await.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export type PreRegisterPreferencesDraft = Record<string, boolean>;

@Injectable({
  providedIn: 'root'
})
export class PreRegisterServiceService {
  private readonly firestore = inject(Firestore);

  // Método simples para gerar um token local.
  // Mantido por compatibilidade nesta etapa.
  // Em revisão futura, vale considerar crypto.randomUUID().
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
  async saveUserPreferences(userPreferences: PreRegisterPreferencesDraft): Promise<void> {
    try {
      const token = this.getToken();
      const prefRef = collection(this.firestore, 'preRegisterPreferences');
      const combinedData = { ...userPreferences, token };

      await addDoc(prefRef, combinedData);
      console.log('Preferências do usuário salvas no Firestore.');
    } catch (error) {
      console.log('Erro ao salvar preferências do usuário:', error);
      throw error;
    }
  }

  // Busca preferências salvas por token do pré-cadastro
  getUserPreferencesByToken$(token: string): Observable<PreRegisterPreferencesDraft | null> {
    const safeToken = (token ?? '').trim();
    if (!safeToken) {
      return of(null);
    }

    const preRegisterCollection = collection(this.firestore, 'preRegisterPreferences');
    const preRegisterQuery = query(preRegisterCollection, where('token', '==', safeToken));

    return from(getDocs(preRegisterQuery)).pipe(
      map((snap) => {
        if (snap.empty) {
          return null;
        }

        return snap.docs[0].data() as PreRegisterPreferencesDraft;
      }),
      catchError((error) => {
        console.log('Erro ao buscar preferências do usuário pelo token:', error);
        return of(null);
      })
    );
  }
}