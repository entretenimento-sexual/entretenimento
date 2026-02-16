// src/app/authentication/register-module/welcome/welcome.component.ts
// Componente de boas-vindas pós-cadastro com verificação de e-mail
// Não esquecer os comentários
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

import { Observable, Subscription, EMPTY, from, interval, of } from 'rxjs';

import { catchError, distinctUntilChanged, exhaustMap, finalize, map, shareReplay,
         startWith, switchMap, take, tap } from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ValidGenders } from 'src/app/core/enums/valid-genders.enum';
import { ValidPreferences } from 'src/app/core/enums/valid-preferences.enum';

// ✅ Centralização de erro/feedback (padrão do projeto)
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

// ✅ AngularFire (instâncias únicas do app.module)
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';

// Firebase modular APIs (escuta e escrita direta)
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { DocumentReference, Unsubscribe } from 'firebase/firestore';
import { doc, getDoc, onSnapshot, setDoc, Timestamp } from 'firebase/firestore';
import { EmulatorEmailVerifyDevService } from 'src/app/core/services/autentication/register/emulator-email-verify-dev.service';
import { environment } from 'src/environments/environment';

type UiBannerVariant = 'info' | 'warn' | 'error' | 'success';
type UiBanner = {
  variant: UiBannerVariant;
  title: string;
  message: string;
  details?: string;
};

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css'],
  standalone: false
})
export class WelcomeComponent implements OnInit {
  // =========================
  //         ESTADOS
  // =========================
  busy = false;
  savingOptional = false;
  sessionInvalid = false;

  // banner local (UX visível no componente)
  banner: UiBanner | null = null;
  showTech = false;

  // status da verificação
  emailVerified = false;
  email: string | null = null;
  lastCheckedAt: Date | null = null;

  // onboarding opcional
  validGenders = Object.values(ValidGenders);
  validPreferences = Object.values(ValidPreferences);

  selectedGender = '';
  selectedPreferencesMap: Record<string, boolean> = {};

  // =========================
  //      INJEÇÕES / VIDA
  // =========================
  private readonly destroyRef = inject(DestroyRef);
  readonly isDevEmu = environment.useEmulators && environment.env === 'dev-emu';

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly auth: Auth,
    private readonly db: Firestore,

    // ✅ erro centralizado / feedback global
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
    private readonly emulatorEmailVerifyDev: EmulatorEmailVerifyDevService,
  ) { }

  markVerifiedDev(): void {
    if (!this.isDevEmu || this.busy) return;

    this.busy = true;

    this.emulatorEmailVerifyDev.markVerifiedInEmulator$().pipe(
      take(1),
      finalize(() => { this.busy = false; }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        // reaproveita seu fluxo normal de sync/reload
        this.setBanner('success', 'DEV: marcado como verificado no emulador', 'O Auth Emulator UI deve refletir o status.');
        this.checkNow();
      },
      error: (err) => {
        // o service já notificou; aqui só mantém banner coerente
        this.setBanner('error', 'DEV: não foi possível marcar no emulador', 'Veja console/logs para detalhes.', err);
      }
    });
  }

  // =========================
  //      STREAMS BASE
  // =========================

  /**
   * Observable reativo do estado do Firebase Auth.
   * - Evita depender de callbacks
   * - Facilita cleanup com takeUntilDestroyed
   */
  private authState$(): Observable<User | null> {
    return new Observable<User | null>((sub) => {
      const unsub = onAuthStateChanged(
        this.auth,
        (u) => sub.next(u),
        (err) => sub.error(err)
      );
      return { unsubscribe: unsub };
    }).pipe(
      startWith(this.auth.currentUser ?? null),
      // reduz re-render desnecessário: troca real de uid/estado de verificação
      distinctUntilChanged((a, b) => (a?.uid ?? null) === (b?.uid ?? null) && !!a?.emailVerified === !!b?.emailVerified),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Observable de existência de documento (watch).
   * Mantém a UX "conta removida durante o cadastro" em tempo real.
   */
  private docExists$(ref: DocumentReference): Observable<boolean> {
    return new Observable<boolean>((sub) => {
      const unsub: Unsubscribe = onSnapshot(
        ref,
        (snap) => sub.next(snap.exists()),
        (err) => sub.error(err)
      );
      return { unsubscribe: unsub };
    }).pipe(distinctUntilChanged());
  }

  // =========================
  //        LIFECYCLE
  // =========================
  private userDocSub: Subscription | null = null;

  ngOnInit(): void {
    const autoCheck = this.route.snapshot.queryParamMap.get('autocheck') === '1';

    // garante cleanup de qualquer polling ativo ao destruir
    this.destroyRef.onDestroy(() => this.stopPolling());

    this.authState$().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (u) => {
        // 1) Sem sessão
        if (!u) {
          this.email = null;
          this.emailVerified = false;
          this.sessionInvalid = true;

          this.setBanner(
            'warn',
            'Sessão não encontrada',
            'Não encontramos uma sessão ativa. Você pode tentar reconectar, recarregar a página ou refazer o cadastro.'
          );

          // se não há usuário, não faz sentido manter watchers/polling
          this.userDocSub?.unsubscribe();
          this.userDocSub = null;
          this.stopPolling();
          return;
        }

        // 2) Sessão ok → sincroniza estado básico
        this.sessionInvalid = false;
        this.email = u.email ?? null;
        this.emailVerified = !!u.emailVerified;

        // 3) Watch do doc do usuário (se sumir durante o fluxo, encerra sessão)
        const ref = doc(this.db, 'users', u.uid);
        this.userDocSub?.unsubscribe();
        this.userDocSub = this.docExists$(ref as unknown as DocumentReference).pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe({
          next: (exists) => {
            if (!exists) {
              this.setBanner('warn', 'Conta indisponível', 'Sua conta precisa de atenção. Você pode sair e refazer o cadastro.');
              this.sessionInvalid = true; // bloqueia ações
              this.stopPolling();

              // ✅ NÃO fazer signOut automático aqui.
              // Deixe um botão "Sair" chamar seu LogoutService/logout voluntário.
              return;
            }
          },
          error: (err) => {
            // aqui vale registrar tecnicamente, mas não precisa “quebrar” a tela
            this.reportError('WelcomeComponent.userDocWatcher', err, true);
          }
        });

        // 4) Se pedido por querystring OU se ainda não verificado, inicia polling
        if (autoCheck || !this.emailVerified) this.startPolling();
      },

      error: (err) => {
        this.sessionInvalid = true;
        this.setBanner('error', 'Erro ao ler sessão', 'Tente recarregar a página.', err);
        this.reportError('WelcomeComponent.authState$', err);
      }
    });
  }

  // =========================
  //    BANNER HELPERS (UX)
  // =========================
  private setBanner(variant: UiBannerVariant, title: string, message: string, details?: any): void {
    let det: string | undefined = undefined;

    // detalhes são opcionais e só aparecem se o usuário clicar (técnico)
    if (details !== undefined) {
      try { det = typeof details === 'string' ? details : JSON.stringify(details, null, 2); }
      catch { det = String(details); }
    }

    this.banner = { variant, title, message, details: det };
    this.showTech = false;
  }

  toggleTech(): void { this.showTech = !this.showTech; }

  copyDetails(): void {
    const det = this.banner?.details;
    if (!det || !navigator?.clipboard) return;
    navigator.clipboard.writeText(det).catch(() => { });
  }

  // CTA: reabrir fluxo de cadastro (sem login)
  restartRegistration(): void {
    this.router.navigate(['/register'], { replaceUrl: true });
  }

  // =========================
  //   ERRO CENTRALIZADO
  // =========================
  /**
   * Padrão do projeto:
   * - registra no handler global (logs/telemetria)
   * - opcionalmente mostra toast (sem duplicar a UX do banner, quando não necessário)
   */
  private reportError(origin: string, err: unknown, silentToast: boolean = false): void {
    try {
      // se seu handler tiver assinatura diferente, ajuste aqui (ponto único)
      (this.globalErrorHandler as any)?.handleError?.(err, origin);
      (this.globalErrorHandler as any)?.capture?.(err, origin);
    } catch {
      // fallback silencioso
    }

    if (!silentToast) {
      this.notify.showError('Ocorreu um erro. Tente novamente.');
    }

    // útil para debug local durante dev
    // (não remove: ajuda a rastrear rapidamente no console)
    // eslint-disable-next-line no-console
    console.error(`[${origin}]`, err);
  }

  // =========================
  //  VERIFICAÇÃO DE E-MAIL
  // =========================

  /**
   * Faz reload do usuário (Auth) e tenta sincronizar emailVerified (Auth → Firestore).
   * Retorna Observable<boolean> para ser usado pelo polling e pelo botão "Verificar agora".
   */
  private reloadAndSync$(): Observable<boolean> {
    const u = this.auth.currentUser;
    if (!u) return of(false);

    // 1) reload pode falhar por rede; não deve “quebrar” o fluxo
    return from(u.reload()).pipe(
      catchError(() => of(void 0)),

      // 2) re-sync dos estados locais após reload
      map(() => {
        const cu = this.auth.currentUser;
        this.emailVerified = !!cu?.emailVerified;
        this.email = cu?.email ?? null;
        this.lastCheckedAt = new Date();
        return cu;
      }),

      // 3) se verificado no Auth, garante espelhamento no Firestore (idempotente)
      switchMap((cu) => {
        if (!cu) return of(false);

        if (cu.emailVerified) {
          return this.emailVerificationService.updateEmailVerificationStatus(cu.uid, true).pipe(
            take(1),
            catchError((err) => {
              // idempotente: se falhar, não impede o usuário de seguir
              this.reportError('WelcomeComponent.updateEmailVerificationStatus', err, true);
              return of(void 0);
            }),
            tap(() => {
              this.setBanner('success', 'E-mail verificado com sucesso!', 'Você já pode seguir para o painel.');
            }),
            map(() => true)
          );
        }

        // 4) fallback: Firestore já marcou como verificado (ex.: handler externo)
        return from(getDoc(doc(this.db, 'users', cu.uid))).pipe(
          map((snap) => {
            const fsVerified = snap.exists() && (snap.data() as any)?.emailVerified === true;
            if (fsVerified) {
              this.emailVerified = true;
              this.setBanner('success', 'E-mail verificado (sincronizado)', 'Você já pode seguir para o painel.');
              return true;
            }
            return false;
          }),
          catchError(() => of(false))
        );
      }),

      // 5) nunca propague erro para o polling (polling deve ser resiliente)
      catchError((err) => {
        this.setBanner('error', 'Erro ao verificar e-mail', 'Tente novamente em instantes.', err);
        this.reportError('WelcomeComponent.reloadAndSync$', err);
        return of(false);
      })
    );
  }

  /**
   * Clique do usuário: tentativa imediata de verificação (sem aguardar polling).
   */
  checkNow(): void {
    if (this.busy) return;

    this.busy = true;
    this.reloadAndSync$().pipe(
      take(1),
      tap((ok) => {
        if (!ok) {
          this.setBanner(
            'info',
            'Ainda não encontramos a verificação',
            'Tente novamente em alguns segundos. Se preferir, reenvie o e-mail.'
          );
          this.restartPolling();
        }
      }),
      finalize(() => { this.busy = false; }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  /**
   * Reenvia o e-mail e reinicia o polling.
   * ⚠️ finalize garante que busy volta ao normal mesmo em erro.
   */
  resendVerificationEmail(): void {
    if (this.busy) return;

    this.busy = true;

    this.emailVerificationService.resendVerificationEmail().pipe(
      tap(() => this.restartPolling()),
      take(1),
      finalize(() => { this.busy = false; }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (msg) => {
        this.setBanner('info', 'E-mail reenviado', msg || 'Confira sua caixa de entrada e spam.');
      },
      error: (err: any) => {
        const code = err?.code || '';

        if (code === 'auth/too-many-requests') {
          this.setBanner('warn', 'Muitas tentativas', 'Aguarde alguns minutos e tente novamente.', err);
        } else if (code === 'auth/quota-exceeded') {
          this.setBanner('warn', 'Limite de envio atingido', 'Tente novamente mais tarde.', err);
        } else {
          this.setBanner('error', 'Erro ao reenviar o e-mail', 'Tente novamente em instantes.', err);
        }

        // registra e mostra toast (erro de ação do usuário → merece toast)
        this.reportError('WelcomeComponent.resendVerificationEmail', err);
      }
    });
  }

  /**
   * Avança para o painel.
   * Mantém a rota de fallback e evita "quebrar" o usuário em caso de erro.
   */
  proceedToDashboard(): void {
    if (!this.emailVerified) {
      this.setBanner('warn', 'E-mail ainda não verificado', 'Verifique seu e-mail antes de continuar.');
      return;
    }

    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/dashboard/principal';

    this.router.navigateByUrl(redirectTo).then((ok) => {
      if (!ok) this.router.navigate(['/dashboard/principal']);
    }).catch(() => {
      this.router.navigate(['/dashboard/principal']);
    });
  }

  // =========================
  //    ONBOARDING OPCIONAL
  // =========================
  saveOptionalProfile(): void {
    const u = this.auth.currentUser;
    const uid = u?.uid;

    if (!uid) {
      this.setBanner('warn', 'Sessão não encontrada', 'Sua sessão não está ativa. Reabra o fluxo de cadastro.');
      this.sessionInvalid = true;
      return;
    }

    const selectedPreferences = Object.entries(this.selectedPreferencesMap)
      .filter(([_, ok]) => ok)
      .map(([k]) => k);

    this.savingOptional = true;

    from(setDoc(
      doc(this.db, 'user_profile', uid),
      {
        gender: this.selectedGender || null,
        preferences: selectedPreferences,
        updatedAt: Timestamp.now()
      },
      { merge: true }
    )).pipe(
      take(1),
      tap(() => {
        this.setBanner('success', 'Preferências salvas', 'Tudo certo! Você pode continuar quando quiser.');
        this.notify.showSuccess('Preferências salvas.');
      }),
      catchError((err) => {
        this.setBanner('error', 'Não foi possível salvar suas preferências agora', 'Tente novamente em instantes.', err);
        this.reportError('WelcomeComponent.saveOptionalProfile', err);
        return EMPTY;
      }),
      finalize(() => { this.savingOptional = false; }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  // =========================
  //         POLLING
  // =========================
  private pollingSub: Subscription | null = null;
  private pollTries = 0;

  /**
   * Polling reativo:
   * - interval + exhaustMap evita concorrência (se uma verificação atrasar, não empilha)
   * - para automaticamente após sucesso ou limite de tentativas
   */
  private startPolling(): void {
    if (this.pollingSub) return;

    this.pollTries = 0;

    this.pollingSub = interval(4000).pipe(
      startWith(0),
      exhaustMap(() => this.reloadAndSync$().pipe(take(1))),
      tap((ok) => {
        this.pollTries++;

        if (ok || this.pollTries >= 8) {
          this.stopPolling();
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private stopPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = null;
  }

  private restartPolling(): void {
    this.stopPolling();
    this.startPolling();
  }

  // =========================
  //        UTILIDADES
  // =========================
  reloadPage(): void {
    window.location.reload();
  }

  openInbox(): void {
    const mail = this.email || '';
    const domain = (mail.split('@')[1] || '').toLowerCase();

    const map: Record<string, string> = {
      'gmail.com': 'https://mail.google.com',
      'googlemail.com': 'https://mail.google.com',
      'outlook.com': 'https://outlook.live.com/mail',
      'hotmail.com': 'https://outlook.live.com/mail',
      'live.com': 'https://outlook.live.com/mail',
      'msn.com': 'https://outlook.live.com/mail',
      'yahoo.com': 'https://mail.yahoo.com',
      'icloud.com': 'https://www.icloud.com/mail',
      'uol.com.br': 'https://email.uol.com.br/',
      'bol.com.br': 'https://email.bol.uol.com.br/',
      'terra.com.br': 'https://mail.terra.com.br/',
      'ig.com.br': 'https://email.ig.com.br/'
    };

    const url = map[domain] || 'about:blank';
    if (url !== 'about:blank') window.open(url, '_blank', 'noopener,noreferrer');
  }

  copyEmail(): void {
    if (!this.email || !navigator?.clipboard) return;
    navigator.clipboard.writeText(this.email).catch(() => { });
  }
} // 518 linhas

/*
Estados do usuário e acesso às rotas em relação a perfil e verificação de e-mail.
GUEST: não autenticado
AUTHED + PROFILE_INCOMPLETE: logado, mas ainda não completou cadastro mínimo
AUTHED + PROFILE_COMPLETE + UNVERIFIED: logado, cadastro ok, mas e-mail não verificado
AUTHED + PROFILE_COMPLETE + VERIFIED: liberado total
*/
