// src/app/register-module/data-access/register-navigation.service.ts
import { Injectable } from '@angular/core';

import {
  RegisterFlowAccessState,
  RegisterFlowVm,
} from './register-flow.model';

@Injectable({ providedIn: 'root' })
export class RegisterNavigationService {
  resolveVm(state: RegisterFlowAccessState): RegisterFlowVm {
    const uid = state.uid?.trim() || null;
    const email = state.email?.trim() || null;

    if (!state.authReady) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'loading',
        nextRoute: '/register',
        progress: 0,
        canContinue: false,
        primaryActionLabel: 'Carregando',
        blockingMessage: 'Estamos preparando sua sessão.',
      };
    }

    if (!uid) {
      return {
        ...state,
        uid: null,
        email,
        currentStep: 'signup',
        nextRoute: '/register',
        progress: 0,
        canContinue: true,
        primaryActionLabel: 'Criar conta',
      };
    }

    if (!state.emailVerified) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'emailVerification',
        nextRoute: '/register/welcome',
        progress: 20,
        canContinue: false,
        primaryActionLabel: 'Já verifiquei',
        secondaryActionLabel: 'Reenviar e-mail',
        blockingMessage: 'Confirme seu e-mail para continuar com segurança.',
      };
    }

    if (!state.userResolved) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'loading',
        nextRoute: '/register/welcome',
        progress: 20,
        canContinue: false,
        primaryActionLabel: 'Carregando',
        blockingMessage: 'Estamos carregando os dados da sua conta.',
      };
    }

    if (!state.userExists) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'accountRecovery',
        nextRoute: '/register/recuperar-conta',
        progress: 30,
        canContinue: true,
        primaryActionLabel: 'Recuperar cadastro',
        blockingMessage:
          'Sua sessão está ativa, mas os dados básicos da conta precisam ser recuperados.',
      };
    }

    if (!state.termsAccepted) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'termsAcceptance',
        nextRoute: '/register/aceitar-termos',
        progress: 35,
        canContinue: true,
        primaryActionLabel: 'Revisar e aceitar termos',
        blockingMessage: 'Aceite os termos vigentes para continuar seu cadastro.',
      };
    }

    if (!state.profileCompleted) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'profileCompletion',
        nextRoute: '/register/finalizar-cadastro',
        progress: 55,
        canContinue: true,
        primaryActionLabel: 'Completar perfil',
      };
    }

    if (!state.adultConsentAccepted) {
      return {
        ...state,
        uid,
        email,
        currentStep: 'adultConsent',
        nextRoute: '/adulto/confirmar',
        progress: 75,
        canContinue: true,
        primaryActionLabel: 'Confirmar maioridade',
      };
    }

    return {
      ...state,
      uid,
      email,
      currentStep: 'preferences',
      nextRoute: `/preferencias/editar/${uid}`,
      progress: 90,
      canContinue: true,
      primaryActionLabel: 'Ajustar preferências',
    };
  }
}
