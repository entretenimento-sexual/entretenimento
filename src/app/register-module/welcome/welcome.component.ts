// src/app/authentication/register-module/welcome/welcome.component.ts
// Componente de boas-vindas pós-cadastro com verificação de e-mail.
//
// Ajustes desta revisão:
// - evita polling desnecessário quando o usuário já está verificado
// - separa estados assíncronos para não travar toda a UI com um único "busy"
// - garante timeout nas ações críticas
// - mantém comentários, reatividade e tratamento centralizado de erros
// - corrige o fluxo DEV para continuar sincronizando quando o Auth já verificou,
//   mas o token/Firestore ainda não refletiram totalmente
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

import { Observable, Subscription, EMPTY, from, interval, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
  timeout,
  filter,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ValidGenders } from 'src/app/core/enums/valid-genders.enum';
import { ValidPreferences } from 'src/app/core/enums/valid-preferences.enum';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';

import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { DocumentReference, Unsubscribe } from 'firebase/firestore';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

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
  standalone: false,
})
export class WelcomeComponent implements OnInit {
  // =========================
  //         ESTADOS
  // =========================
  checkingVerification = false;
  resendingVerificationEmail = false;
  markingVerifiedDev = false;
  savingOptional = false;
  sessionInvalid = false;

  banner: UiBanner | null = null;
  showTech = false;

  emailVerified = false;
  email: string | null = null;
  lastCheckedAt: Date | null = null;

  validGenders = Object.values(ValidGenders);
  validPreferences = Object.values(ValidPreferences);

  selectedGender = '';
  selectedPreferencesMap: Record<string, boolean> = {};

  private readonly destroyRef = inject(DestroyRef);
  readonly isDevEmu = environment.useEmulators && environment.env === 'dev-emu';

  private readonly ACTION_TIMEOUT_MS = 15_000;

  /**
   * Getter agregado mantido para facilitar desabilitação geral da UI,
   * sem perder a granularidade dos estados específicos.
   */
  get busy(): boolean {
    return (
      this.checkingVerification ||
      this.resendingVerificationEmail ||
      this.markingVerifiedDev ||
      this.savingOptional
    );
  }

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly auth: Auth,
    private readonly db: Firestore,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
    private readonly emulatorEmailVerifyDev: EmulatorEmailVerifyDevService
  ) {}

  /**
   * Acelera o fluxo em dev-emu sem depender do clique no e-mail real.
   *
   * Regra importante:
   * - se o Auth já refletiu emailVerified=true, mas a sincronização ainda não concluiu,
   *   mantemos/reiniciamos o polling para terminar a propagação corretamente.
   */
  markVerifiedDev(): void {
    if (
      !this.isDevEmu ||
      this.markingVerifiedDev ||
      this.checkingVerification ||
      this.resendingVerificationEmail
    ) {
      return;
    }

    this.stopPolling();
    this.markingVerifiedDev = true;

    this.emulatorEmailVerifyDev
      .markVerifiedInEmulatorDebug$()
      .pipe(
        take(1),
        switchMap((dbg) =>
          this.reloadAndSync$().pipe(
            take(1),
            map((syncedOk) => ({ dbg, syncedOk }))
          )
        ),
        tap(({ dbg, syncedOk }) => {
          const details = {
            traceId: dbg.traceId,
            okAuth: dbg.after.emailVerified,
            okSync: syncedOk,
            uid: dbg.uid,
            email: dbg.email,
            listOob: dbg.listOob,
            apply: dbg.apply,
            note: dbg.note,
          };

          if (dbg.after.emailVerified && syncedOk) {
            this.setBanner(
              'success',
              `DEV OK (trace: ${dbg.traceId})`,
              'E-mail verificado no Auth Emulator e sincronizado no app.',
              details
            );
            return;
          }

          if (dbg.after.emailVerified && !syncedOk) {
            this.setBanner(
              'info',
              `DEV parcial (trace: ${dbg.traceId})`,
              'O Auth Emulator já marcou o e-mail como verificado, mas a sincronização final ainda está propagando.',
              details
            );
            this.restartPolling();
            return;
          }

          this.setBanner(
            'warn',
            `DEV não verificou (trace: ${dbg.traceId})`,
            dbg.note ?? 'Não foi possível aplicar a verificação no emulador.',
            details
          );
          this.restartPolling();
        }),
        catchError((err) => {
          const traceId = (err as any)?.traceId;
          const payload = (err as any)?.emuPayload;

          this.setBanner(
            'error',
            `DEV erro${traceId ? ` (trace: ${traceId})` : ''}`,
            'Falha ao marcar como verificado no emulador.',
            payload ?? err
          );
          return of(void 0);
        }),
        finalize(() => {
          this.markingVerifiedDev = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /**
   * Observable reativo do estado do Firebase Auth.
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
      distinctUntilChanged(
        (a, b) =>
          (a?.uid ?? null) === (b?.uid ?? null) &&
          !!a?.emailVerified === !!b?.emailVerified
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Observable de existência do documento do usuário.
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

  private userDocSub: Subscription | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      this.userDocSub?.unsubscribe();
      this.userDocSub = null;
    });

    this.authState$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          if (!u) {
            this.email = null;
            this.emailVerified = false;
            this.sessionInvalid = true;

            this.setBanner(
              'warn',
              'Sessão não encontrada',
              'Não encontramos uma sessão ativa. Recarregue a página ou refaça o cadastro.'
            );

            this.userDocSub?.unsubscribe();
            this.userDocSub = null;
            this.stopPolling();
            return;
          }

          this.sessionInvalid = false;
          this.email = u.email ?? null;
          this.emailVerified = !!u.emailVerified;

          const ref = doc(this.db, 'users', u.uid);

          this.userDocSub?.unsubscribe();
          this.userDocSub = this.docExists$(ref as unknown as DocumentReference)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (exists) => {
                if (!exists) {
                  this.setBanner(
                    'warn',
                    'Conta indisponível',
                    'Sua conta precisa de atenção. Você pode sair e refazer o cadastro.'
                  );
                  this.sessionInvalid = true;
                  this.stopPolling();
                }
              },
              error: (err) => {
                this.reportError('WelcomeComponent.userDocWatcher', err, true);
              },
            });

          if (this.emailVerified) {
            this.stopPolling();
            return;
          }

          if (!this.sessionInvalid) {
            this.startPolling();
          }
        },
        error: (err) => {
          this.sessionInvalid = true;
          this.setBanner('error', 'Erro ao ler sessão', 'Tente recarregar a página.', err);
          this.reportError('WelcomeComponent.authState$', err);
        },
      });
  }

  private setBanner(
    variant: UiBannerVariant,
    title: string,
    message: string,
    details?: unknown
  ): void {
    let det: string | undefined;

    if (details !== undefined) {
      try {
        det = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
      } catch {
        det = String(details);
      }
    }

    this.banner = { variant, title, message, details: det };
    this.showTech = false;
  }

  toggleTech(): void {
    this.showTech = !this.showTech;
  }

  copyDetails(): void {
    const det = this.banner?.details;
    if (!det || !navigator?.clipboard) return;

    navigator.clipboard.writeText(det).catch(() => {});
  }

  restartRegistration(): void {
    this.router.navigate(['/register'], { replaceUrl: true });
  }

  private reportError(origin: string, err: unknown, silentToast: boolean = false): void {
    try {
      (this.globalErrorHandler as any)?.handleError?.(err, origin);
      (this.globalErrorHandler as any)?.capture?.(err, origin);
    } catch {
      // noop
    }

    if (!silentToast) {
      this.notify.showError('Ocorreu um erro. Tente novamente.');
    }

    // eslint-disable-next-line no-console
    console.error(`[${origin}]`, err);
  }

  /**
   * Faz reload do usuário e tenta sincronizar emailVerified.
   */
  private reloadAndSync$(): Observable<boolean> {
    const u = this.auth.currentUser;
    if (!u) return of(false);

    const traceId = `wel_sync_${Date.now().toString(16)}_${Math.random()
      .toString(16)
      .slice(2, 6)}`;
    const DBG = (window as any)?.DBG ?? (() => {});

    DBG('[Welcome.reloadAndSync$] start', { traceId, uid: u.uid });

    return from(u.reload()).pipe(
      timeout({ first: this.ACTION_TIMEOUT_MS }),
      catchError((err) => {
        DBG('[Welcome.reloadAndSync$] user.reload():fail', { traceId, err });
        return of(void 0);
      }),
      map(() => {
        const cu = this.auth.currentUser;

        this.emailVerified = !!cu?.emailVerified;
        this.email = cu?.email ?? null;
        this.lastCheckedAt = new Date();

        DBG('[Welcome.reloadAndSync$] after reload', {
          traceId,
          uid: cu?.uid ?? null,
          emailVerified: !!cu?.emailVerified,
        });

        return cu;
      }),
      switchMap((cu) => {
        if (!cu) return of(false);

        if (!cu.emailVerified) {
          return from(getDoc(doc(this.db, 'users', cu.uid))).pipe(
            timeout({ first: this.ACTION_TIMEOUT_MS }),
            map((snap) => {
              const fsVerified =
                snap.exists() && (snap.data() as any)?.emailVerified === true;

              DBG('[Welcome.reloadAndSync$] fs fallback', { traceId, fsVerified });

              if (fsVerified) {
                this.emailVerified = true;
                this.setBanner(
                  'success',
                  'E-mail verificado (sincronizado)',
                  'Você já pode seguir para o painel.'
                );
                return true;
              }

              return false;
            }),
            catchError((err) => {
              DBG('[Welcome.reloadAndSync$] fs fallback:fail', { traceId, err });
              return of(false);
            })
          );
        }

        return from(cu.getIdTokenResult(true)).pipe(
          timeout({ first: this.ACTION_TIMEOUT_MS }),
          map((res) => {
            const claimVerified = res?.claims?.['email_verified'] === true;

            DBG('[Welcome.reloadAndSync$] token claims', {
              traceId,
              emailVerified: true,
              claimVerified,
            });

            return claimVerified;
          }),
          switchMap((claimVerified) => {
            if (!claimVerified) {
              this.setBanner(
                'info',
                'Verificação propagando…',
                'O Auth já marcou como verificado, mas o token ainda não atualizou. Aguarde alguns segundos e tente novamente.'
              );
              return of(false);
            }

            DBG('[Welcome.reloadAndSync$] fs update:attempt', {
              traceId,
              uid: cu.uid,
            });

            return this.emailVerificationService.updateEmailVerificationStatus(cu.uid, true).pipe(
              take(1),
              tap(() => DBG('[Welcome.reloadAndSync$] fs update:ok', { traceId })),
              catchError((err) => {
                DBG('[Welcome.reloadAndSync$] fs update:fail', { traceId, err });
                this.reportError('WelcomeComponent.updateEmailVerificationStatus', err, true);
                return of(false as any);
              }),
              map((v: any) => {
                if (v === false) return false;

                this.setBanner(
                  'success',
                  'E-mail verificado com sucesso!',
                  'Você já pode seguir para o painel.'
                );
                return true;
              })
            );
          })
        );
      }),
      catchError((err) => {
        DBG('[Welcome.reloadAndSync$] fatal', { traceId, err });
        this.setBanner(
          'error',
          'Erro ao verificar e-mail',
          'Tente novamente em instantes.',
          err
        );
        this.reportError('WelcomeComponent.reloadAndSync$', err);
        return of(false);
      })
    );
  }

  checkNow(): void {
    if (
      this.checkingVerification ||
      this.resendingVerificationEmail ||
      this.markingVerifiedDev
    ) {
      return;
    }

    this.stopPolling();
    this.checkingVerification = true;

    this.reloadAndSync$()
      .pipe(
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
        finalize(() => {
          this.checkingVerification = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  resendVerificationEmail(): void {
    if (
      this.resendingVerificationEmail ||
      this.checkingVerification ||
      this.markingVerifiedDev
    ) {
      return;
    }

    this.stopPolling();
    this.resendingVerificationEmail = true;

    this.emailVerificationService
      .resendVerificationEmail()
      .pipe(
        take(1),
        timeout({ first: this.ACTION_TIMEOUT_MS }),
        tap((msg) => {
          this.setBanner(
            'info',
            'E-mail reenviado',
            msg || 'Confira sua caixa de entrada e spam.'
          );

          if (!this.emailVerified && !this.sessionInvalid) {
            this.restartPolling();
          }
        }),
        catchError((err: any) => {
          const code = err?.code || '';

          if (code === 'auth/too-many-requests') {
            this.setBanner(
              'warn',
              'Muitas tentativas',
              'Aguarde alguns minutos e tente novamente.',
              err
            );
          } else if (code === 'auth/quota-exceeded') {
            this.setBanner(
              'warn',
              'Limite de envio atingido',
              'Tente novamente mais tarde.',
              err
            );
          } else {
            this.setBanner(
              'error',
              'Erro ao reenviar o e-mail',
              'Tente novamente em instantes.',
              err
            );
          }

          this.reportError('WelcomeComponent.resendVerificationEmail', err);
          return EMPTY;
        }),
        finalize(() => {
          this.resendingVerificationEmail = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  proceedToDashboard(): void {
    if (!this.emailVerified) {
      this.setBanner(
        'warn',
        'E-mail ainda não verificado',
        'Verifique seu e-mail antes de continuar.'
      );
      return;
    }

    const redirectTo =
      this.route.snapshot.queryParamMap.get('redirectTo') || '/dashboard/principal';

    this.router
      .navigateByUrl(redirectTo)
      .then((ok) => {
        if (!ok) {
          this.router.navigate(['/dashboard/principal']);
        }
      })
      .catch(() => {
        this.router.navigate(['/dashboard/principal']);
      });
  }

  saveOptionalProfile(): void {
    const u = this.auth.currentUser;
    const uid = u?.uid;

    if (!uid) {
      this.setBanner('warn', 'Sessão não encontrada', 'Sua sessão não está ativa.');
      this.sessionInvalid = true;
      return;
    }

    const selectedPreferences = Object.entries(this.selectedPreferencesMap)
      .filter(([_, ok]) => ok)
      .map(([k]) => k);

    this.savingOptional = true;

    const ref = doc(this.db as any, 'users', uid, 'preferences', 'onboarding');

    const payload = {
      gender: this.selectedGender || null,
      preferences: selectedPreferences,
      updatedAt: serverTimestamp(),
    };

    from(setDoc(ref, payload as any, { merge: true }))
      .pipe(
        take(1),
        timeout({ first: this.ACTION_TIMEOUT_MS }),
        tap(() => {
          this.setBanner('success', 'Preferências salvas', 'Tudo certo!');
          this.notify.showSuccess('Preferências salvas.');
        }),
        catchError((err) => {
          this.setBanner('error', 'Não foi possível salvar agora', 'Tente novamente.', err);
          this.reportError('WelcomeComponent.saveOptionalProfile', err);
          return EMPTY;
        }),
        finalize(() => {
          this.savingOptional = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private pollingSub: Subscription | null = null;
  private pollTries = 0;

  private startPolling(): void {
    if (this.pollingSub || this.emailVerified || this.sessionInvalid) {
      return;
    }

    const DBG = (window as any)?.DBG ?? (() => {});
    const maxTries = this.isDevEmu ? 30 : 8;

    this.pollTries = 0;

    this.pollingSub = interval(4000)
      .pipe(
        startWith(0),
        filter(
          () =>
            !this.checkingVerification &&
            !this.resendingVerificationEmail &&
            !this.markingVerifiedDev &&
            !this.sessionInvalid &&
            !this.emailVerified
        ),
        exhaustMap(() => this.reloadAndSync$().pipe(take(1))),
        tap((ok) => {
          this.pollTries++;

          DBG('[Welcome.poll]', { try: this.pollTries, ok });

          if (ok) {
            this.stopPolling();
            return;
          }

          if (this.pollTries >= maxTries) {
            this.stopPolling();
            this.setBanner(
              'warn',
              'Tempo esgotado',
              'Não conseguimos sincronizar a verificação a tempo. Clique em “Checar agora” em alguns segundos.'
            );
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private stopPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = null;
  }

  private restartPolling(): void {
    this.stopPolling();
    this.startPolling();
  }

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
      'ig.com.br': 'https://email.ig.com.br',
    };

    const url = map[domain] || 'about:blank';
    if (url !== 'about:blank') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  copyEmail(): void {
    if (!this.email || !navigator?.clipboard) return;
    navigator.clipboard.writeText(this.email).catch(() => {});
  }
} // Linha 760
