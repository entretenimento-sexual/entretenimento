// src/app/core/services/autentication/social-auth.service.ts
// =============================================================================
// SOCIAL AUTH SERVICE (Google Sign-In) — Firebase Auth + Firestore
//
// Padrão “plataforma grande” (preparado para evolução):
// - Auth prova identidade; Firestore guarda estado de conta.
// - Mantém compat: `role` (IUserDados.role) = tier do produto.
// - Adiciona skeleton de ACL: tier + roles + permissions + entitlements + accountStatus.
// - Não faz logout (LogoutService cuida disso).
// =============================================================================

import { Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';

import { Auth } from '@angular/fire/auth';
import { GoogleAuthProvider, signInWithPopup, type User as FirebaseUser } from 'firebase/auth';

import { Observable, defer, of } from 'rxjs';
import { catchError, map, switchMap, take, tap } from 'rxjs/operators';

import { FirestoreReadService } from '../data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { UserRepositoryService } from '../data-handling/firestore/repositories/user-repository.service';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

import { toEpochOrZero } from 'src/app/core/utils/epoch-utils';
import { environment } from 'src/environments/environment';
import { AccountStatus, DEFAULT_ACCESS_CONTROL, IUserAccessControl, Tier } from '../../interfaces/interfaces-user-dados/user-access-control.interface';

// -----------------------------------------------------------------------------
// UserDoc = doc real de users/{uid} no Firestore (mais amplo que IUserRegistrationData)
// -> aqui nasce o fix do TS: lastLogin existe nesse tipo, sem mexer no IUserRegistrationData.
// -----------------------------------------------------------------------------
type UserDoc = IUserRegistrationData & {
  // Operacionais (não são “registro”, mas existem no doc real)
  lastLogin?: number | null;
  createdAt?: number | null;
  updatedAtMs?: number | null;

  // ACL skeleton (evolução “plataforma grande”)
  tier?: Tier;                     // canônico futuro (monetização)
  roles?: string[];                // staff roles (futuro: custom claims)
  permissions?: string[];          // permissões granulares
  entitlements?: string[];         // direitos de produto/feature flags
  accountStatus?: AccountStatus;   // enforcement/moderação

  // Compat legado
  suspended?: boolean;
  accountLocked?: boolean;
};

@Injectable({ providedIn: 'root' })
export class SocialAuthService {
  private readonly debug = !!environment.enableDebugTools;

  constructor(
    private readonly auth: Auth,
    private readonly read: FirestoreReadService,
    private readonly write: FirestoreWriteService,
    private readonly userRepo: UserRepositoryService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly router: Router,
    private readonly envInjector: EnvironmentInjector
  ) { }

  // ===========================================================================
  // Google Login (Observable-first)
  // ===========================================================================
  googleLogin(): Observable<IUserDados | null> {
    const provider = new GoogleAuthProvider();

    // UX “padrão big tech”: força escolha de conta
    provider.setCustomParameters({ prompt: 'select_account' });

    return this.signInWithPopupInCtx$(provider).pipe(
      switchMap((cred) => {
        const fu = cred?.user;
        if (!fu) return of(null);

        const nowMs = Date.now();
        return this.bootstrapUserAfterAuth$(fu, nowMs);
      }),
      catchError((err) => {
        this.handleAuthPopupError(err);
        return of(null);
      })
    );
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private signInWithPopupInCtx$(provider: GoogleAuthProvider): Observable<any> {
    // AngularFire/Firebase Auth: rodar dentro do Injection Context
    return defer(() =>
      runInInjectionContext(this.envInjector, () => signInWithPopup(this.auth, provider))
    );
  }

  private bootstrapUserAfterAuth$(fu: FirebaseUser, nowMs: number): Observable<IUserDados | null> {
    const uid = fu.uid;

    // Login: use server snapshot para evitar cache stale
    return this.read.getDocument<UserDoc>('users', uid, { source: 'server' }).pipe(
      take(1),
      switchMap((doc) => (doc ? this.onExistingUserLogin$(doc, fu, nowMs) : this.onNewUserLogin$(fu, nowMs)))
    );
  }

  // --------------------------------------------------------------------------
  // Novo usuário via Google: cria seed mínimo + ACL skeleton (sem quebrar compat)
  // --------------------------------------------------------------------------
  private onNewUserLogin$(fu: FirebaseUser, nowMs: number): Observable<IUserDados> {
    const uid = fu.uid;

    // Seu baseline: basic
    const acl: IUserAccessControl = {
      ...DEFAULT_ACCESS_CONTROL,
      tier: 'basic',
    };

    // Seed compat com IUserRegistrationData + campos operacionais/ACL
    const seed: Partial<UserDoc> = {
      uid,
      email: fu.email || '',
      nickname: '',
      photoURL: fu.photoURL || undefined,

      // compat: role = tier (produto)
      role: acl.tier,

      emailVerified: !!fu.emailVerified,
      isSubscriber: false,

      firstLogin: nowMs,
      registrationDate: nowMs,
      lastLogin: nowMs,

      acceptedTerms: { accepted: false, date: nowMs },
      profileCompleted: false,

      // ACL skeleton (futuro)
      tier: acl.tier,
      roles: acl.roles,
      permissions: acl.permissions,
      entitlements: acl.entitlements,
      accountStatus: acl.accountStatus,

      // enforcement compat
      suspended: false,
      accountLocked: false,

      updatedAtMs: nowMs,
      createdAt: nowMs,
    };

    return this.write.setDocument('users', uid, seed as any, {
      merge: true,
      context: 'SocialAuthService.onNewUserLogin'
    }).pipe(
      tap(() => this.userRepo.updateUserInStateAndCache(uid, seed as any)),
      map(() => this.mapToUserDados(seed as any, nowMs)),
      tap(() => this.router.navigate(['/register/finalizar-cadastro'])),
      catchError((err) => {
        this.reportError(err, { phase: 'onNewUserLogin', uid });
        return of(null as any);
      })
    );
  }

  // --------------------------------------------------------------------------
  // Usuário existente: patch de lastLogin + espelhos úteis + normalização ACL
  // --------------------------------------------------------------------------
  private onExistingUserLogin$(existing: UserDoc, fu: FirebaseUser, nowMs: number): Observable<IUserDados> {
    const uid = fu.uid;

    const status: AccountStatus =
      (existing.accountStatus as any) ??
      (existing.suspended ? 'suspended' : 'active');

    if (status === 'deleted') {
      this.errorNotifier.showError('Conta indisponível. Entre em contato com o suporte.');
      return of(this.mapToUserDados(existing, nowMs)).pipe(
        tap(() => this.router.navigate(['/login'], { replaceUrl: true }))
      );
    }

    if (status === 'suspended' || status === 'locked' || existing.accountLocked) {
      this.errorNotifier.showError('Sua conta está temporariamente restrita.');
      return of(this.mapToUserDados(existing, nowMs)).pipe(
        tap(() => this.router.navigate(['/login'], { replaceUrl: true }))
      );
    }

    // Normaliza tier/role (compat) para evitar docs antigos sem role
    const tier = this.normalizeTier((existing as any).tier ?? existing.role ?? 'basic');

    const patch: Partial<UserDoc> = {
      lastLogin: nowMs,
      updatedAtMs: nowMs,

      // espelhos úteis do Auth
      emailVerified: !!fu.emailVerified,
      photoURL: fu.photoURL || existing.photoURL || undefined,

      // compat + canônico
      role: this.isTierRole(existing.role) ? existing.role : tier,
      tier: (existing as any).tier ?? tier,

      // skeleton ACL (garante arrays não nulos)
      roles: Array.isArray((existing as any).roles) && (existing as any).roles.length ? (existing as any).roles : ['user'],
      permissions: Array.isArray((existing as any).permissions) ? (existing as any).permissions : [],
      entitlements: Array.isArray((existing as any).entitlements) ? (existing as any).entitlements : [],
      accountStatus: (existing as any).accountStatus ?? 'active',
    };

    return this.write.updateDocument('users', uid, patch as any, {
      context: 'SocialAuthService.onExistingUserLogin'
    }).pipe(
      tap(() => this.userRepo.updateUserInStateAndCache(uid, { ...existing, ...patch } as any)),
      map(() => this.mapToUserDados({ ...existing, ...patch } as any, nowMs)),
      tap(() => {
        const needsFinish = !existing.nickname || !existing.gender || existing.profileCompleted === false;
        if (needsFinish) this.router.navigate(['/register/finalizar-cadastro']);
        else this.router.navigate(['/dashboard/principal']);
      }),
      catchError((err) => {
        this.reportError(err, { phase: 'onExistingUserLogin', uid });
        return of(null as any);
      })
    );
  }

  // ===========================================================================
  // Tier helpers (role atual do app = tier)
  // ===========================================================================

  private isTierRole(v: any): v is IUserDados['role'] {
    return v === 'visitante' || v === 'free' || v === 'basic' || v === 'premium' || v === 'vip';
  }

  private normalizeTier(v: any): Tier {
    return (v === 'free' || v === 'basic' || v === 'premium' || v === 'vip') ? v : 'basic';
  }

  // ===========================================================================
  // Mapper (users doc -> IUserDados)
  // ===========================================================================

  private mapToUserDados(doc: Partial<UserDoc>, nowMs: number): IUserDados {
    const tier = this.normalizeTier((doc as any).tier ?? doc.role ?? 'basic');

    return {
      uid: doc.uid || '',
      email: (doc.email ?? null) as any,
      emailVerified: !!doc.emailVerified,

      nickname: (doc.nickname ? doc.nickname : null) as any,
      photoURL: (doc.photoURL ?? null) as any,

      // compat: role = tier (produto)
      role: tier,

      descricao: (doc as any).descricao ?? '',
      isSubscriber: !!doc.isSubscriber,
      socialLinks: (doc as any).socialLinks ?? {},

      firstLogin: toEpochOrZero((doc as any).firstLogin ?? nowMs),
      lastLogin: toEpochOrZero((doc as any).lastLogin ?? nowMs),

      acceptedTerms: (doc as any).acceptedTerms,
      profileCompleted: (doc as any).profileCompleted,
      suspended: !!(doc as any).suspended,
    } as IUserDados;
  }

  // ===========================================================================
  // Popup errors
  // ===========================================================================

  private handleAuthPopupError(err: any): void {
    const code = String(err?.code ?? '');

    const expected =
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request';

    if (code === 'auth/popup-blocked') {
      this.errorNotifier.showError('O navegador bloqueou o popup. Permita popups e tente novamente.');
    }

    if (code === 'auth/account-exists-with-different-credential') {
      this.errorNotifier.showError('Já existe uma conta com este e-mail. Use o método de login anterior.');
    }

    this.reportError(err, { phase: 'googleLogin.popup', code }, expected);
  }

  private reportError(err: any, context: any, silent = false): void {
    try {
      if (this.debug) console.log('[SocialAuthService]', context, err);

      const e = new Error('[SocialAuthService] error');
      (e as any).silent = silent;
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
}
