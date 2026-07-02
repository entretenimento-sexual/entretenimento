// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
// -----------------------------------------------------------------------------
// FinalizarCadastroComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade exclusiva:
// - completar o perfil mÃ­nimo obrigatÃ³rio da plataforma;
// - gravar profileCompleted=true;
// - gravar dados pÃºblicos bÃ¡sicos em public_profiles via FirestoreUserWriteService.
//
// Este componente NÃƒO deve:
// - verificar e-mail;
// - gravar emailVerified;
// - inferir que e-mail verificado significa perfil completo.
//
// SeparaÃ§Ã£o correta:
// - Completar perfil: profileCompleted=true.
// - Verificar e-mail: emailVerified=true, feito em outro fluxo.
//
// Assim, o estado abaixo Ã© vÃ¡lido:
// - profileCompleted=true
// - emailVerified=false

import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { of, EMPTY } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

import { IBGELocationService } from 'src/app/core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { FirestoreUserWriteService } from 'src/app/core/services/data-handling/firestore-user-write.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

type ProfileCompletionPayload = Partial<IUserRegistrationData> & Partial<IUserDados>;

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css'],
  standalone: false,
})
export class FinalizarCadastroComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------------------------
  // Contexto de entrada da tela
  // ---------------------------------------------------------------------------

  public entryReason: 'profile_incomplete' | 'email_unverified' | null = null;
  public pageTitle = 'Complete seu perfil';
  public introText = 'Complete os dados abaixo para liberar os recursos bÃ¡sicos da plataforma.';

  // ---------------------------------------------------------------------------
  // Dados da UI / formulÃ¡rio
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
   * Bootstrap inicial da tela.
   * NÃ£o deve ser usado para travar permanentemente o formulÃ¡rio.
   */
  public isLoading = true;

  /**
   * Loading exclusivo do submit.
   */
  public isSubmitting = false;

  public isUploading = false;
  public progressValue = 0;
  public uploadMessage = '';
  public avatarFile: File | null = null;

  public showSubscriptionOptions = false;
  public formErrors: { [key: string]: string } = {};

  constructor(
    private readonly ibgeLocationService: IBGELocationService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly firestoreUserWrite: FirestoreUserWriteService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly storageService: StorageService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService
  ) {}

  private getLS(): Storage | null {
    try {
      return (globalThis as any).localStorage ?? null;
    } catch {
      return null;
    }
  }

  ngOnInit(): void {
    this.resolveEntryContext();
    this.loadEstados();

    this.currentUserStore.user$
      .pipe(
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
            this.router.navigate(['/login']).catch(() => {});
          }
        }),
        switchMap((u) => (u?.uid ? this.loadUserForForm$(u) : of(void 0))),
        finalize(() => {
          this.isLoading = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        error: (err) => {
          this.globalErrorHandler.handleError(err);
          this.message = 'Erro ao carregar seus dados. Tente novamente.';
          this.errorNotification.showError(this.message);
        },
      });
  }

  /**
   * Carrega dados atuais do usuÃ¡rio para preencher o formulÃ¡rio.
   *
   * Importante:
   * aqui NÃƒO recarregamos Auth e NÃƒO consultamos emailVerified.
   * Esta tela sÃ³ cuida de profileCompleted.
   */
  private loadUserForForm$(userData: IUserDados) {
    return this.firestoreUserQuery.getUser(userData.uid).pipe(
      take(1),
      tap((doc) => {
        this.email = doc?.email ?? userData.email ?? '';
        this.nickname = doc?.nickname ?? userData.nickname ?? '';

        this.gender = doc?.gender ?? userData.gender ?? '';
        this.orientation = doc?.orientation ?? userData.orientation ?? '';
        this.selectedEstado = doc?.estado ?? userData.estado ?? '';
        this.selectedMunicipio = doc?.municipio ?? userData.municipio ?? '';

        if (this.selectedEstado) {
          this.loadMunicipiosForEstado(this.selectedEstado);
        }
      }),
      map(() => void 0)
    );
  }

  loadEstados(): void {
    this.ibgeLocationService
      .getEstados()
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

  private loadMunicipiosForEstado(estado: string): void {
    this.ibgeLocationService
      .getMunicipios(estado)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (municipios) => {
          this.municipios = municipios;
        },
        error: (err) => {
          this.globalErrorHandler.handleError(err);
          this.errorNotification.showError('Erro ao carregar municÃ­pios.');
        },
      });
  }

  onEstadoChange(): void {
    if (!this.selectedEstado) {
      this.municipios = [];
      this.selectedMunicipio = '';
      this.checkFieldValidity('municipio', this.selectedMunicipio, 'MunicÃ­pio');
      return;
    }

    this.loadMunicipiosForEstado(this.selectedEstado);
  }

  /**
   * Define rota apÃ³s completar perfil.
   */
  private getRedirectToAfterCompletion(uid: string): string {
    const raw = this.route.snapshot.queryParamMap.get('redirectTo');

    if (!raw) return `/perfil/${uid}`;
    if (!raw.startsWith('/') || raw.startsWith('//')) return `/perfil/${uid}`;

    return raw;
  }

  onSubmit(): void {
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.message = '';

    this.currentUserStore
      .getLoggedUserUID$()
      .pipe(
        take(1),

        switchMap((uid) => {
          if (!uid) {
            const msg = 'Erro: UID do usuÃ¡rio nÃ£o encontrado.';
            this.message = msg;
            this.errorNotification.showError(msg);
            return EMPTY;
          }

          this.checkFieldValidity('gender', this.gender, 'Quero me cadastrar como');
          this.checkFieldValidity('estado', this.selectedEstado, 'Estado');
          this.checkFieldValidity('municipio', this.selectedMunicipio, 'MunicÃ­pio');

          if (
            this.isFieldInvalid('gender') ||
            this.isFieldInvalid('estado') ||
            this.isFieldInvalid('municipio')
          ) {
            const msg = 'Por favor, preencha os campos obrigatÃ³rios.';
            this.message = msg;
            this.errorNotification.showError(msg);
            return EMPTY;
          }

          return this.firestoreUserQuery.getUser(uid).pipe(
            take(1),
            map((existingUserData) => ({ uid, existingUserData }))
          );
        }),

        switchMap((ctx) => {
          const { uid, existingUserData } = ctx;

          if (!existingUserData) {
            throw new Error('Dados do usuÃ¡rio nÃ£o encontrados.');
          }

          const completionPayload: ProfileCompletionPayload = {
            uid: existingUserData.uid,
            nickname: existingUserData.nickname || '',

            gender: this.gender || existingUserData.gender || '',
            orientation: this.orientation || existingUserData.orientation || '',
            estado: this.selectedEstado || existingUserData.estado || '',
            municipio: this.selectedMunicipio || existingUserData.municipio || '',

            /**
             * Ato exclusivo desta tela:
             * completar o perfil.
             *
             * NÃ£o incluir emailVerified aqui.
             */
            profileCompleted: true,
          };

          return this.firestoreUserWrite.saveInitialUserData$(uid, completionPayload).pipe(
            switchMap(() =>
              this.avatarFile
                ? this.storageService.uploadProfileAvatar(this.avatarFile, uid)
                : of(null)
            ),
            switchMap((photoURL) => {
              if (!photoURL) return of(void 0);

              const photoPatch: ProfileCompletionPayload = {
                ...completionPayload,
                photoURL,
              };

              return this.firestoreUserWrite.saveInitialUserData$(uid, photoPatch);
            }),
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
      )
      .subscribe({
        next: () => {
          this.message = 'Perfil finalizado com sucesso!';
          this.currentUserStore.patch({ profileCompleted: true });

          const targetUid = this.currentUserStore.getLoggedUserUIDSnapshot();

          if (!targetUid) {
            const msg = 'Perfil salvo, mas nÃ£o foi possÃ­vel redirecionar automaticamente.';
            this.message = msg;
            this.errorNotification.showError(msg);
            return;
          }

          const target = this.getRedirectToAfterCompletion(targetUid);
          this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {});
        },
      });
  }

  uploadFile(event: any): void {
    const file = event?.target?.files?.[0] as File | undefined;

    this.avatarFile = null;
    this.isUploading = false;
    this.progressValue = 0;
    this.uploadMessage = '';

    if (!file) {
      return;
    }

    if (!file.type?.startsWith('image/')) {
      this.errorNotification.showError('Selecione uma imagem válida.');
      return;
    }

    const maxSizeBytes = 10 * 1024 * 1024;

    if (file.size > maxSizeBytes) {
      this.errorNotification.showError('A foto deve ter no máximo 10 MB.');
      return;
    }

    /**
     * A foto só será enviada no submit, depois que os dados básicos
     * forem salvos com sucesso.
     */
    this.avatarFile = file;
  }

  /**
   * Contexto visual apenas.
   *
   * Mesmo se a entrada vier por reason=email_unverified, esta tela continua
   * fazendo somente a finalizaÃ§Ã£o do perfil. A verificaÃ§Ã£o de e-mail permanece
   * em fluxo prÃ³prio.
   */
  private resolveEntryContext(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');

    if (reason === 'profile_incomplete') {
      this.entryReason = 'profile_incomplete';
      this.pageTitle = 'Complete seu perfil';
      this.introText = 'Complete os dados abaixo para liberar os recursos bÃ¡sicos da plataforma.';
      return;
    }

    if (reason === 'email_unverified') {
      this.entryReason = 'email_unverified';
      this.pageTitle = 'Complete seu perfil';
      this.introText =
        'Seu e-mail ainda pode estar pendente de verificaÃ§Ã£o, mas esta etapa serve apenas para completar seu perfil.';
      return;
    }

    this.entryReason = null;
    this.pageTitle = 'Complete seu perfil';
    this.introText = 'Complete os dados abaixo para liberar os recursos bÃ¡sicos da plataforma.';
  }

  checkFieldValidity(field: string, value: unknown, label?: string): void {
    const nice = label || field;
    const empty = value === null || value === undefined || String(value).trim() === '';

    this.formErrors[field] = empty ? `O campo "${nice}" Ã© obrigatÃ³rio.` : '';
  }

  isFieldInvalid(field: string): boolean {
    return !!this.formErrors[field];
  }

  goToSubscription(): void {
    this.router.navigate(['/subscription-plan']).catch(() => {});
  }

  continueWithoutSubscription(): void {
    this.router.navigate(['/dashboard/principal']).catch(() => {});
  }
}
