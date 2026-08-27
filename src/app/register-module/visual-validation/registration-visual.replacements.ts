import { Injectable, inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import type { User } from '@angular/fire/auth';
import { Observable, defer, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import type {
  IbgeMunicipio,
  IbgeUF,
} from '../../core/services/general/api/ibge-location.service';
import type { RegisterFlowVm } from '../data-access/register-flow.model';

/**
 * Replacements exclusivos da configuração `registration-visual`.
 *
 * Este arquivo nunca é usado pelos builds normais. Ele existe para permitir
 * que o CI renderize as telas reais do onboarding sem criar contas nos
 * backends dev/prod nem enfraquecer guards em runtime.
 */

export const authGuard: CanActivateFn = () => true;
export const guestOnlyCanActivate: CanActivateFn = () => true;
export const guestOnlyCanMatch: CanMatchFn = () => true;
export const emailVerifiedGuard: CanActivateFn = () => true;
export const registrationStepGuard: CanActivateFn = () => true;
export const accountLifecycleGuard: CanActivateFn = () => true;

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly verificationPendingUser = {
    uid: 'visual-user',
    email: 'visual@example.com',
    emailVerified: false,
  } as User;

  readonly authUser$: Observable<User | null> = of(null);
  readonly uid$: Observable<string | null> = of(null);
  readonly ready$: Observable<boolean> = of(true);
  readonly emailVerified$: Observable<boolean> = of(false);
  readonly isAuthenticated$: Observable<boolean> = of(false);
  readonly readyAuthUser$: Observable<User | null> = of(null);
  readonly readyUid$: Observable<string | null> = of(null);

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  refreshCurrentUser$(): Observable<User | null> {
    return of(this.verificationPendingUser);
  }

  signOut$(): Observable<void> {
    return of(void 0);
  }

  get currentAuthUser(): User | null {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class RegisterFlowFacade {
  private readonly router = inject(Router);

  readonly vm$: Observable<RegisterFlowVm> = defer(() =>
    of(this.resolveVm(this.router.url))
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  readonly nextRoute$: Observable<string> = this.vm$.pipe(
    map((vm) => vm.nextRoute)
  );

  private resolveVm(url: string): RegisterFlowVm {
    const path = String(url || '/').split('?')[0].split('#')[0];
    const base = {
      authReady: true,
      uid: 'visual-user',
      email: 'visual@example.com',
      emailVerified: true,
      userResolved: true,
      userExists: true,
      termsAccepted: true,
      profileCompleted: true,
      adultConsentAccepted: true,
      initialAdultConsentRequired: true,
      progress: 90,
      canContinue: true,
      primaryActionLabel: 'Continuar',
    } satisfies Omit<RegisterFlowVm, 'currentStep' | 'nextRoute'>;

    if (path === '/register/welcome') {
      return {
        ...base,
        emailVerified: false,
        termsAccepted: false,
        profileCompleted: false,
        adultConsentAccepted: false,
        currentStep: 'emailVerification',
        nextRoute: '/register/welcome',
        progress: 20,
        canContinue: false,
        primaryActionLabel: 'Já verifiquei',
        secondaryActionLabel: 'Reenviar e-mail',
        blockingMessage: 'Confirme seu e-mail para continuar com segurança.',
      };
    }

    if (path === '/register/aceitar-termos') {
      return {
        ...base,
        termsAccepted: false,
        profileCompleted: false,
        adultConsentAccepted: false,
        currentStep: 'termsAcceptance',
        nextRoute: '/register/aceitar-termos',
        progress: 35,
        primaryActionLabel: 'Revisar e aceitar termos',
        blockingMessage: 'Aceite os termos vigentes para continuar seu cadastro.',
      };
    }

    if (path === '/register/finalizar-cadastro') {
      return {
        ...base,
        profileCompleted: false,
        adultConsentAccepted: false,
        currentStep: 'profileCompletion',
        nextRoute: '/register/finalizar-cadastro',
        progress: 55,
        primaryActionLabel: 'Completar perfil',
      };
    }

    if (path === '/adulto/confirmar') {
      return {
        ...base,
        adultConsentAccepted: false,
        currentStep: 'adultConsent',
        nextRoute: '/adulto/confirmar',
        progress: 75,
        primaryActionLabel: 'Confirmar maioridade',
      };
    }

    return {
      ...base,
      currentStep: 'preferences',
      nextRoute: '/preferencias/editar/visual-user',
    };
  }
}

export interface ProfileCompletionInitialData {
  email: string;
  nickname: string;
  gender: string;
  orientation: string;
  estado: string;
  municipio: string;
}

export interface ProfileCompletionSubmitInput {
  uid: string;
  vm: RegisterFlowVm;
  nickname: string;
  gender: string;
  orientation: string;
  estado: string;
  municipio: string;
}

export type ProfileCompletionAvatarUploadStatus =
  | 'skipped'
  | 'uploaded'
  | 'upload_failed'
  | 'avatar_patch_failed';

export interface ProfileCompletionAvatarUploadInput {
  uid: string;
  file: File | null;
  onProgress?: (progress: number) => void;
}

export interface ProfileCompletionAvatarUploadResult {
  status: ProfileCompletionAvatarUploadStatus;
  photoURL?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileCompletionFacade {
  loadUserForFormByUid$(
    _uid: string,
    vm: RegisterFlowVm
  ): Observable<ProfileCompletionInitialData | null> {
    return of({
      email: vm.email ?? 'visual@example.com',
      nickname: '',
      gender: '',
      orientation: '',
      estado: '',
      municipio: '',
    });
  }

  saveProfileCompletion$(_input: ProfileCompletionSubmitInput): Observable<void> {
    return of(void 0);
  }

  uploadProfileAvatarAfterSave$(
    _input: ProfileCompletionAvatarUploadInput
  ): Observable<ProfileCompletionAvatarUploadResult> {
    return of({ status: 'skipped' });
  }

  getEstados$(): Observable<IbgeUF[]> {
    return of([
      { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
      { id: 35, sigla: 'SP', nome: 'São Paulo' },
    ] as IbgeUF[]);
  }

  getMunicipios$(estado: string): Observable<IbgeMunicipio[]> {
    if (estado === 'SP') {
      return of([
        { id: 3550308, nome: 'São Paulo' },
        { id: 3509502, nome: 'Campinas' },
      ] as IbgeMunicipio[]);
    }

    return of([
      { id: 3304557, nome: 'Rio de Janeiro' },
      { id: 3303302, nome: 'Niterói' },
    ] as IbgeMunicipio[]);
  }
}
