// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
// -----------------------------------------------------------------------------
// FinalizarCadastroComponent
// -----------------------------------------------------------------------------
// Responsabilidade:
// - Permitir que o usuário complete o perfil mínimo obrigatório após registro
// - Carregar dados auxiliares (estados/municípios)
// - Ler o contexto de entrada da rota (profile_incomplete | email_unverified)
// - Salvar os dados mínimos no Firestore
//
// Ajuste desta versão:
// - NÃO esconder o formulário no bootstrap inicial
// - Separar loading de bootstrap (isLoading) de loading de submit (isSubmitting)
// - Mostrar feedback de "salvando" apenas quando houver submit real
// -----------------------------------------------------------------------------

import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, EMPTY } from 'rxjs';
import { catchError, filter, finalize, map, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { IBGELocationService } from 'src/app/core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { FirestoreUserWriteService } from 'src/app/core/services/data-handling/firestore-user-write.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css'],
  standalone: false
})
export class FinalizarCadastroComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------------------------
  // Contexto de entrada da tela
  // ---------------------------------------------------------------------------
  public entryReason: 'profile_incomplete' | 'email_unverified' | null = null;
  public pageTitle = 'Finalize seu cadastro';
  public introText = 'Complete os dados abaixo para liberar recursos da plataforma.';

  // ---------------------------------------------------------------------------
  // Dados da UI / formulário
  // ---------------------------------------------------------------------------
  public email = '';
  public nickname = '';
  public gender = '';
  public orientation = '';
  public selectedEstado = '';
  public selectedMunicipio = '';
  public estados: any[] = [];
  public municipios: any[] = [];

  // ---------------------------------------------------------------------------
  // Estados visuais
  // ---------------------------------------------------------------------------
  public message = '';

  /**
   * isLoading:
   * - representa o bootstrap interno inicial da tela
   * - NÃO deve mais esconder o formulário inteiro
   */
  public isLoading = true;

  /**
   * isSubmitting:
   * - representa EXCLUSIVAMENTE o envio do formulário
   * - é esse flag que deve controlar loading visual de submit e disable do botão
   */
  public isSubmitting = false;

  public isUploading = false;
  public progressValue = 0;
  public uploadMessage = '';
  public avatarFile: File | null = null;

  public showSubscriptionOptions = false;
  public formErrors: { [key: string]: string } = {};

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
    private readonly ibgeLocationService: IBGELocationService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly firestoreUserWrite: FirestoreUserWriteService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly storageService: StorageService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService,
  ) { }

  private getLS(): Storage | null {
    try {
      return (globalThis as any).localStorage ?? null;
    } catch {
      return null;
    }
  }

  ngOnInit(): void {
    // 1) Resolve o contexto da entrada na rota
    this.resolveEntryContext();

    // 2) Carrega estados (independente da autenticação)
    this.loadEstados();

    // 3) Resolve usuário atual (store -> localStorage -> login)
    this.currentUserStore.user$.pipe(
      take(1),
      switchMap((u) => {
        if (u) return of(u);

        const ls = this.getLS();
        const raw = ls?.getItem?.('currentUser') ?? null;
        if (!raw) return of(null);

        try {
          const parsed = JSON.parse(raw) as IUserDados;
          return of(parsed);
        } catch {
          return of(null);
        }
      }),
      tap((u) => {
        if (!u?.uid) {
          this.router.navigate(['/login']);
        }
      }),
      switchMap((u) => u?.uid ? this.verifyEmailAndLoadUser$(u) : of(void 0)),
      finalize(() => {
        // bootstrap inicial terminou
        this.isLoading = false;
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      error: (err) => {
        this.globalErrorHandler.handleError(err);
        this.message = 'Erro ao carregar seus dados. Tente novamente.';
        this.errorNotification.showError(this.message);
      }
    });
  }

  /**
   * Carrega dados básicos do usuário e confirma, de forma reativa,
   * o status atual do Auth.
   */
  private verifyEmailAndLoadUser$(userData: IUserDados) {
    return this.firestoreUserQuery.getUser(userData.uid).pipe(
      take(1),
      tap((doc) => {
        this.email = doc?.email ?? userData.email ?? '';
        this.nickname = doc?.nickname ?? userData.nickname ?? '';
      }),
      switchMap(() => this.emailVerificationService.reloadCurrentUser().pipe(take(1))),
      tap((authVerified) => {
        // Só exibe aviso de e-mail se a entrada da tela estiver ligada a isso.
        if (!authVerified && this.entryReason === 'email_unverified') {
          this.message = 'Seu e-mail ainda não aparece como verificado. Se você já verificou, volte e tente novamente.';
        }
      }),
      map(() => void 0)
    );
  }

  loadEstados(): void {
    this.ibgeLocationService.getEstados()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (estados) => {
          this.estados = estados;
        },
        error: (err) => {
          this.globalErrorHandler.handleError(err);
          this.errorNotification.showError('Erro ao carregar estados.');
        },
      });
  }

  onEstadoChange(): void {
    if (!this.selectedEstado) {
      this.municipios = [];
      this.selectedMunicipio = '';
      this.checkFieldValidity('municipio', this.selectedMunicipio, 'Município');
      return;
    }

    this.ibgeLocationService.getMunicipios(this.selectedEstado)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (municipios) => {
          this.municipios = municipios;
        },
        error: (err) => {
          this.globalErrorHandler.handleError(err);
          this.errorNotification.showError('Erro ao carregar municípios.');
        },
      });
  }

  /**
   * Define para onde o usuário deve ir após concluir o perfil.
   * Se houver redirectTo seguro, respeita.
   * Caso contrário, usa o perfil próprio como fallback.
   */
  private getRedirectToAfterCompletion(uid: string): string {
    const raw = this.route.snapshot.queryParamMap.get('redirectTo');
    if (!raw) return `/perfil/${uid}`;
    if (!raw.startsWith('/') || raw.startsWith('//')) return `/perfil/${uid}`;
    return raw;
  }

  onSubmit(): void {
    // Evita submit duplicado
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.message = '';

    this.currentUserStore.getLoggedUserUID$().pipe(
      take(1),

      // 1) validações iniciais
      switchMap((uid) => {
        if (!uid) {
          const msg = 'Erro: UID do usuário não encontrado.';
          this.message = msg;
          this.errorNotification.showError(msg);
          return EMPTY;
        }

        this.checkFieldValidity('gender', this.gender, 'Quero me cadastrar como');
        this.checkFieldValidity('estado', this.selectedEstado, 'Estado');
        this.checkFieldValidity('municipio', this.selectedMunicipio, 'Município');

        if (
          this.isFieldInvalid('gender') ||
          this.isFieldInvalid('estado') ||
          this.isFieldInvalid('municipio')
        ) {
          const msg = 'Por favor, preencha os campos obrigatórios.';
          this.message = msg;
          this.errorNotification.showError(msg);
          return EMPTY;
        }

        // 2) confirma status real do Auth e carrega o usuário atual do Firestore
        return this.emailVerificationService.reloadCurrentUser().pipe(
          take(1),
          switchMap((authVerified) =>
            this.firestoreUserQuery.getUser(uid).pipe(
              take(1),
              map((existingUserData) => ({ uid, existingUserData, authVerified }))
            )
          )
        );
      }),

      // 3) monta payload e salva
      switchMap((ctx) => {
        const { uid, existingUserData, authVerified } = ctx;

        if (!existingUserData) {
          throw new Error('Dados do usuário não encontrados.');
        }

        const now = Date.now();

        const updatedUserData: IUserRegistrationData = {
          uid: existingUserData.uid,
          email: existingUserData.email || '',
          nickname: existingUserData.nickname || '',

          // Verdade do Auth
          emailVerified: authVerified === true,

          isSubscriber: !!existingUserData.isSubscriber,
          firstLogin: typeof existingUserData.firstLogin === 'number' ? existingUserData.firstLogin : now,
          registrationDate: typeof (existingUserData as any).registrationDate === 'number'
            ? (existingUserData as any).registrationDate
            : now,

          gender: this.gender || existingUserData.gender || '',
          orientation: this.orientation || existingUserData.orientation || '',
          estado: this.selectedEstado || existingUserData.estado || '',
          municipio: this.selectedMunicipio || existingUserData.municipio || '',

          acceptedTerms: existingUserData.acceptedTerms ?? {
            accepted: true,
            date: now
          },

          // Finalização do perfil mínimo
          profileCompleted: true,
        };

        return this.firestoreUserWrite.saveInitialUserData$(uid, updatedUserData).pipe(
          switchMap(() =>
            this.avatarFile
              ? this.storageService.uploadProfileAvatar(this.avatarFile, uid)
              : of(null)
          ),
          map(() => void 0)
        );
      }),

      finalize(() => {
        this.isSubmitting = false;
      }),

      takeUntilDestroyed(this.destroyRef),

      catchError((err) => {
        this.globalErrorHandler.handleError(err);
        const msg = 'Ocorreu um erro ao finalizar o cadastro. Tente novamente.';
        this.message = msg;
        this.errorNotification.showError(msg);
        return EMPTY;
      })
    ).subscribe({
      next: () => {
        this.message = 'Cadastro finalizado com sucesso!';

        /**
         * Mantido:
         * aguardamos a store refletir profileCompleted=true antes de navegar,
         * para reduzir risco de corrida com guard/logo após o write.
         */
        this.currentUserStore.user$.pipe(
          filter((user): user is IUserDados => !!user?.uid && user.profileCompleted === true),
          take(1)
        ).subscribe((user) => {
          const target = this.getRedirectToAfterCompletion(user.uid);
          this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {});
        });
      }
    });
  }

  /**
   * Upload local simulado para feedback visual.
   * Pode ser refinado depois para progresso real do provider de storage.
   */
  uploadFile(event: any): void {
    const file = event?.target?.files?.[0] as File | undefined;

    if (!file) {
      this.uploadMessage = 'Nenhum arquivo selecionado.';
      return;
    }

    this.avatarFile = file;
    this.isUploading = true;
    this.progressValue = 0;

    const g: any = globalThis as any;

    const timer = g.setInterval(() => {
      if (this.progressValue >= 100) {
        g.clearInterval(timer);
        this.isUploading = false;
        this.uploadMessage = 'Upload concluído com sucesso!';
      } else {
        this.progressValue += 10;
      }
    }, 300);

    g.setTimeout(() => {
      if (this.progressValue < 100) {
        g.clearInterval(timer);
        this.isUploading = false;
        this.uploadMessage = 'Erro ao realizar o upload. Tente novamente.';
      }
    }, 5000);
  }

  /**
   * Ajusta o texto da tela conforme o motivo da entrada.
   */
  private resolveEntryContext(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');

    if (reason === 'profile_incomplete') {
      this.entryReason = 'profile_incomplete';
      this.pageTitle = 'Complete seu perfil';
      this.introText = 'Complete os dados abaixo para liberar recursos da plataforma.';
      return;
    }

    if (reason === 'email_unverified') {
      this.entryReason = 'email_unverified';
      this.pageTitle = 'Finalize seu cadastro';
      this.introText = 'Obrigado por verificar seu e-mail. Complete os dados abaixo para liberar recursos.';
      return;
    }

    this.entryReason = null;
    this.pageTitle = 'Finalize seu cadastro';
    this.introText = 'Complete os dados abaixo para liberar recursos da plataforma.';
  }

  checkFieldValidity(field: string, value: unknown, label?: string): void {
    const nice = label || field;
    const empty = value === null || value === undefined || String(value).trim() === '';
    this.formErrors[field] = empty ? `O campo "${nice}" é obrigatório.` : '';
  }

  isFieldInvalid(field: string): boolean {
    return !!this.formErrors[field];
  }

  goToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }

  continueWithoutSubscription(): void {
    this.router.navigate(['/dashboard/principal']);
  }
}