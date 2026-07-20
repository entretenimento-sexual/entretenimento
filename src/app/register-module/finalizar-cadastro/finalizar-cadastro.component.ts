// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
import {
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  inject,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

import { EMPTY, Observable, Subject, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  filter,
  finalize,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { UnsavedChangesAware } from 'src/app/core/guards/unsaved-changes/unsaved-changes.guard';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { LocalDraftService } from 'src/app/core/services/drafts/local-draft.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type {
  IbgeMunicipio,
  IbgeUF,
} from 'src/app/core/services/general/api/ibge-location.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';
import { ProfileCompletionFacade } from '../data-access/profile-completion.facade';

type ProfileCompletionField = 'nickname' | 'gender' | 'estado' | 'municipio';
type ProfileCompletionMessageKind =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | null;
type ReportableError = Error | HttpErrorResponse;

type ProfileCompletionDraft = {
  nickname: string;
  gender: string;
  orientation: string;
  estado: string;
  municipio: string;
};

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css'],
  standalone: false,
})
export class FinalizarCadastroComponent
implements OnInit, UnsavedChangesAware
{
  private readonly destroyRef = inject(DestroyRef);
  private readonly draftChanges$ = new Subject<void>();

  public entryReason: 'profile_incomplete' | 'email_unverified' | null = null;
  public pageTitle = 'Complete seu perfil';
  public introText =
    'Complete os dados abaixo para liberar os recursos básicos da plataforma.';

  public email = '';
  public nickname = '';
  public needsNickname = false;

  public gender = '';
  public orientation = '';
  public selectedEstado = '';
  public selectedMunicipio = '';

  public estados: IbgeUF[] = [];
  public municipios: IbgeMunicipio[] = [];

  public message = '';
  public messageKind: ProfileCompletionMessageKind = null;
  public isLoading = true;
  public isSubmitting = false;
  public isUploading = false;
  public progressValue = 0;
  public uploadMessage = '';
  public avatarFile: File | null = null;

  public formErrors: Partial<Record<ProfileCompletionField, string>> = {};

  private latestVm: RegisterFlowVm | null = null;
  private draftReady = false;
  private draftKey = '';
  private initialDraftSnapshot = '';

  constructor(
    private readonly registerFlow: RegisterFlowFacade,
    private readonly profileCompletion: ProfileCompletionFacade,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly localDraft: LocalDraftService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.resolveEntryContext();
    this.loadEstados();
    this.observeDraftChanges();

    this.registerFlow.vm$
      .pipe(
        tap((vm) => {
          this.latestVm = vm;
        }),
        filter((vm) => vm.authReady),
        take(1),
        switchMap((vm) => {
          if (!vm.uid) {
            this.router
              .navigate(['/login'], { replaceUrl: true })
              .catch(() => {});
            return of(void 0);
          }

          if (vm.currentStep !== 'profileCompletion') {
            this.router
              .navigateByUrl(vm.nextRoute || '/register/welcome', {
                replaceUrl: true,
              })
              .catch(() => {});
            return of(void 0);
          }

          return this.loadUserForFormByUid$(vm.uid, vm);
        }),
        finalize(() => {
          this.isLoading = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        error: (error) => {
          this.reportError(
            error,
            'Erro ao carregar seus dados. Tente novamente.'
          );
        },
      });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  hasUnsavedChanges(): boolean {
    if (!this.draftReady || this.isSubmitting) return false;
    return (
      this.currentDraftSnapshot() !== this.initialDraftSnapshot ||
      this.avatarFile !== null
    );
  }

  discardUnsavedChanges(): void {
    this.localDraft.remove(this.draftKey);
    this.initialDraftSnapshot = this.currentDraftSnapshot();
    this.avatarFile = null;
  }

  onDraftChange(): void {
    if (!this.draftReady || this.isSubmitting) return;
    this.draftChanges$.next();
  }

  private clearSubmitMessages(): void {
    this.message = '';
    this.messageKind = null;
    this.uploadMessage = '';
  }

  private setErrorMessage(message: string): void {
    this.message = message;
    this.messageKind = 'error';
    this.errorNotification.showError(message);
  }

  private setWarningMessage(message: string): void {
    this.message = message;
    this.messageKind = 'warning';
    this.errorNotification.showWarning(message);
  }

  private setSuccessMessage(message: string): void {
    this.message = message;
    this.messageKind = 'success';
  }

  private normalizeReportableError(error: unknown): ReportableError {
    if (error instanceof Error || error instanceof HttpErrorResponse) {
      return error;
    }

    if (typeof error === 'string' && error.trim()) {
      return new Error(error.trim());
    }

    return new Error(
      '[FinalizarCadastroComponent] Erro desconhecido.'
    );
  }

  private reportError(error: unknown, message: string): void {
    this.globalErrorHandler.handleError(
      this.normalizeReportableError(error)
    );
    this.setErrorMessage(message);
  }

  private setUploadWarning(message: string): void {
    this.uploadMessage = message;
    this.errorNotification.showWarning(message);
  }

  private resetAvatarSelectionState(): void {
    this.avatarFile = null;
    this.isUploading = false;
    this.progressValue = 0;
    this.uploadMessage = '';
  }

  private loadUserForFormByUid$(
    uid: string,
    vm: RegisterFlowVm
  ): Observable<void> {
    return this.profileCompletion.loadUserForFormByUid$(uid, vm).pipe(
      take(1),
      tap((initialData) => {
        if (!initialData) {
          this.setErrorMessage(
            'Não encontramos os dados da sua conta. Tente entrar novamente.'
          );
          this.router
            .navigate(['/login'], { replaceUrl: true })
            .catch(() => {});
          return;
        }

        this.email = initialData.email;
        this.nickname = NicknameUtils.normalizarApelido(
          initialData.nickname
        );
        this.needsNickname = !this.nickname;
        this.gender = initialData.gender;
        this.orientation = initialData.orientation;
        this.selectedEstado = initialData.estado;
        this.selectedMunicipio = initialData.municipio;

        this.initializeDraftState(uid);

        if (this.selectedEstado) {
          this.loadMunicipiosForEstado(this.selectedEstado);
        }
      }),
      map(() => void 0)
    );
  }

  loadEstados(): void {
    this.profileCompletion
      .getEstados$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (estados) => {
          this.estados = estados;
        },
        error: (error) => {
          this.reportError(error, 'Erro ao carregar estados.');
        },
      });
  }

  private loadMunicipiosForEstado(estado: string): void {
    this.profileCompletion
      .getMunicipios$(estado)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (municipios) => {
          this.municipios = municipios;
        },
        error: (error) => {
          this.reportError(error, 'Erro ao carregar municípios.');
        },
      });
  }

  onEstadoChange(): void {
    if (!this.selectedEstado) {
      this.municipios = [];
      this.selectedMunicipio = '';
      this.checkFieldValidity(
        'municipio',
        this.selectedMunicipio,
        'Município'
      );
      this.onDraftChange();
      return;
    }

    this.loadMunicipiosForEstado(this.selectedEstado);
    this.onDraftChange();
  }

  private resolveSafeRedirectTo(): string | null {
    const raw = String(
      this.route.snapshot.queryParamMap.get('redirectTo') ?? ''
    ).trim();

    if (
      !raw ||
      !raw.startsWith('/') ||
      raw.startsWith('//') ||
      raw.startsWith('/login') ||
      raw.startsWith('/register') ||
      raw.startsWith('/adulto/confirmar')
    ) {
      return null;
    }

    return raw;
  }

  private getRedirectToAfterCompletion(uid: string): string {
    const vm = this.latestVm;
    const redirectTo = this.resolveSafeRedirectTo();

    if (vm?.uid === uid && !vm.adultConsentAccepted) {
      const query = redirectTo
        ? `?redirectTo=${encodeURIComponent(redirectTo)}`
        : '';
      return `/adulto/confirmar${query}`;
    }

    if (redirectTo) return redirectTo;

    if (
      vm?.uid === uid &&
      vm.nextRoute &&
      vm.nextRoute !== '/register/finalizar-cadastro'
    ) {
      return vm.nextRoute;
    }

    return `/perfil/${uid}`;
  }

  private canSubmitProfileCompletion(): boolean {
    const vm = this.latestVm;

    if (!vm?.uid) {
      this.setErrorMessage('Erro: UID do usuário não encontrado.');
      return false;
    }

    if (!vm.emailVerified) {
      this.setWarningMessage(
        'Confirme seu e-mail antes de finalizar o cadastro.'
      );
      this.router
        .navigate(['/register/welcome'], {
          replaceUrl: true,
          queryParams: { reason: 'email_unverified' },
        })
        .catch(() => {});
      return false;
    }

    if (vm.currentStep !== 'profileCompletion') {
      this.setWarningMessage(
        'Esta etapa do cadastro não está disponível agora.'
      );
      this.router
        .navigateByUrl(vm.nextRoute || '/register/welcome', {
          replaceUrl: true,
        })
        .catch(() => {});
      return false;
    }

    return true;
  }

  onSubmit(): void {
    if (this.isSubmitting) return;
    if (!this.canSubmitProfileCompletion()) return;

    const uid = this.latestVm?.uid?.trim() || null;
    const vm = this.latestVm;
    if (!uid || !vm) return;

    this.checkFieldValidity('nickname', this.nickname, 'Apelido');
    this.checkFieldValidity(
      'gender',
      this.gender,
      'Quero me cadastrar como'
    );
    this.checkFieldValidity(
      'estado',
      this.selectedEstado,
      'Estado'
    );
    this.checkFieldValidity(
      'municipio',
      this.selectedMunicipio,
      'Município'
    );

    if (
      this.isFieldInvalid('nickname') ||
      this.isFieldInvalid('gender') ||
      this.isFieldInvalid('estado') ||
      this.isFieldInvalid('municipio')
    ) {
      this.setErrorMessage(
        'Por favor, preencha os campos obrigatórios.'
      );
      return;
    }

    this.isSubmitting = true;
    this.clearSubmitMessages();

    this.profileCompletion
      .saveProfileCompletion$({
        uid,
        vm,
        nickname: NicknameUtils.normalizarApelido(this.nickname),
        gender: this.gender,
        orientation: this.orientation,
        estado: this.selectedEstado,
        municipio: this.selectedMunicipio,
      })
      .pipe(
        take(1),
        switchMap(() => this.uploadAvatarAfterProfileSave$(uid)),
        map(() => void 0),
        finalize(() => {
          this.isSubmitting = false;
        }),
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          const code = String(
            (error as { code?: unknown })?.code ?? ''
          );

          if (code === 'nickname/in-use') {
            this.formErrors['nickname'] =
              'Este apelido já está em uso.';
            this.setErrorMessage(
              'Escolha outro apelido para continuar.'
            );
            return EMPTY;
          }

          if (code === 'nickname/invalid') {
            this.formErrors['nickname'] =
              'Informe um apelido válido.';
            this.setErrorMessage('Revise o apelido informado.');
            return EMPTY;
          }

          this.reportError(
            error,
            'Ocorreu um erro ao finalizar o cadastro. Tente novamente.'
          );
          return EMPTY;
        })
      )
      .subscribe({
        next: () => {
          this.setSuccessMessage('Perfil finalizado com sucesso!');

          const normalizedNickname =
            NicknameUtils.normalizarApelido(this.nickname);

          this.currentUserStore.patch({
            nickname: normalizedNickname,
            profileCompleted: true,
            gender: this.gender,
            orientation: this.orientation,
            estado: this.selectedEstado,
            municipio: this.selectedMunicipio,
          });

          this.localDraft.remove(this.draftKey);
          this.initialDraftSnapshot = this.currentDraftSnapshot();
          this.avatarFile = null;

          const target = this.getRedirectToAfterCompletion(uid);
          this.router
            .navigateByUrl(target, { replaceUrl: true })
            .catch(() => {});
        },
      });
  }

  private uploadAvatarAfterProfileSave$(uid: string): Observable<void> {
    if (!this.avatarFile) return of(void 0);

    this.isUploading = true;
    this.progressValue = 0;
    this.uploadMessage = '';

    return this.profileCompletion
      .uploadProfileAvatarAfterSave$({
        uid,
        file: this.avatarFile,
        onProgress: (progress) => {
          this.isUploading = true;
          this.progressValue = Math.max(
            0,
            Math.min(100, Math.round(progress || 0))
          );
        },
      })
      .pipe(
        tap((result) => {
          if (result.status === 'uploaded' && result.photoURL) {
            this.progressValue = 100;
            this.currentUserStore.patch({
              photoURL: result.photoURL,
            });
            return;
          }

          if (result.status === 'avatar_patch_failed') {
            this.progressValue = 100;
            this.setUploadWarning(
              'Perfil salvo. A foto foi enviada, mas não foi possível atualizar o avatar agora.'
            );
            return;
          }

          if (result.status === 'upload_failed') {
            this.setUploadWarning(
              'Perfil salvo. Não foi possível enviar a foto agora.'
            );
          }
        }),
        finalize(() => {
          this.isUploading = false;
        }),
        map(() => void 0)
      );
  }

  uploadFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    this.resetAvatarSelectionState();
    if (!file) {
      this.onDraftChange();
      return;
    }

    const acceptedTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);

    if (!acceptedTypes.has(file.type?.toLowerCase())) {
      this.setErrorMessage(
        'Selecione uma imagem em JPG, PNG ou WebP.'
      );
      return;
    }

    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      this.setErrorMessage('A foto deve ter no máximo 10 MB.');
      return;
    }

    this.avatarFile = file;
    this.onDraftChange();
  }

  private initializeDraftState(uid: string): void {
    this.draftKey = `profile-completion:${uid}`;
    this.initialDraftSnapshot = this.currentDraftSnapshot();

    const draft = this.localDraft.load<ProfileCompletionDraft>(
      this.draftKey
    );

    if (draft) {
      if (this.needsNickname) {
        this.nickname = NicknameUtils.normalizarApelido(
          draft.nickname
        );
      }
      this.gender = String(draft.gender ?? '');
      this.orientation = String(draft.orientation ?? '');
      this.selectedEstado = String(draft.estado ?? '');
      this.selectedMunicipio = String(draft.municipio ?? '');
    }

    this.draftReady = true;
  }

  private observeDraftChanges(): void {
    this.draftChanges$
      .pipe(
        debounceTime(500),
        filter(() => this.hasUnsavedChanges()),
        tap(() => {
          this.localDraft.save(
            this.draftKey,
            this.currentDraftValue()
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private currentDraftValue(): ProfileCompletionDraft {
    return {
      nickname: this.needsNickname
        ? NicknameUtils.normalizarApelido(this.nickname)
        : '',
      gender: String(this.gender ?? '').trim(),
      orientation: String(this.orientation ?? '').trim(),
      estado: String(this.selectedEstado ?? '').trim(),
      municipio: String(this.selectedMunicipio ?? '').trim(),
    };
  }

  private currentDraftSnapshot(): string {
    return JSON.stringify(this.currentDraftValue());
  }

  private resolveEntryContext(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');

    if (reason === 'profile_incomplete') {
      this.entryReason = 'profile_incomplete';
      this.pageTitle = 'Complete seu perfil';
      this.introText =
        'Complete os dados abaixo para liberar os recursos básicos da plataforma.';
      return;
    }

    if (reason === 'email_unverified') {
      this.entryReason = 'email_unverified';
      this.pageTitle = 'Complete seu perfil';
      this.introText =
        'Seu e-mail ainda pode estar pendente de verificação, mas esta etapa serve apenas para completar seu perfil.';
      return;
    }

    this.entryReason = null;
    this.pageTitle = 'Complete seu perfil';
    this.introText =
      'Complete os dados abaixo para liberar os recursos básicos da plataforma.';
  }

  checkFieldValidity(
    field: ProfileCompletionField,
    value: unknown,
    label?: string
  ): void {
    const nice = label || field;
    const clean = String(value ?? '').trim();

    if (field === 'nickname') {
      const display = NicknameUtils.normalizarApelido(clean);
      const valid =
        NicknameUtils.isApelidoValido(display) &&
        NicknameUtils.isApelidoIndiceValido(display);

      this.formErrors[field] = valid
        ? ''
        : 'Use de 4 a 24 caracteres: letras, números, espaço, ponto, hífen ou sublinhado.';
      this.onDraftChange();
      return;
    }

    this.formErrors[field] = clean
      ? ''
      : `O campo "${nice}" é obrigatório.`;
    this.onDraftChange();
  }

  isFieldInvalid(field: ProfileCompletionField): boolean {
    return !!this.formErrors[field];
  }
}
