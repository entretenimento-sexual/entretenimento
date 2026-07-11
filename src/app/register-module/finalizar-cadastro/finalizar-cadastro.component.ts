// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

import { EMPTY, Observable, of } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type {
  IbgeMunicipio,
  IbgeUF,
} from 'src/app/core/services/general/api/ibge-location.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';
import { ProfileCompletionFacade } from '../data-access/profile-completion.facade';

type ProfileCompletionField = 'gender' | 'estado' | 'municipio';
type ProfileCompletionMessageKind = 'success' | 'error' | 'warning' | 'info' | null;
type ReportableError = Error | HttpErrorResponse;

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css'],
  standalone: false,
})
export class FinalizarCadastroComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  public entryReason: 'profile_incomplete' | 'email_unverified' | null = null;
  public pageTitle = 'Complete seu perfil';
  public introText = 'Complete os dados abaixo para liberar os recursos básicos da plataforma.';

  public email = '';
  public nickname = '';

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

  constructor(
    private readonly registerFlow: RegisterFlowFacade,
    private readonly profileCompletion: ProfileCompletionFacade,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService
  ) {}

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

  private normalizeReportableError(err: unknown): ReportableError {
    if (err instanceof Error || err instanceof HttpErrorResponse) {
      return err;
    }

    if (typeof err === 'string' && err.trim()) {
      return new Error(err.trim());
    }

    return new Error('[FinalizarCadastroComponent] Erro desconhecido.');
  }

  private reportError(err: unknown, message: string): void {
    this.globalErrorHandler.handleError(this.normalizeReportableError(err));
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

  ngOnInit(): void {
    this.resolveEntryContext();
    this.loadEstados();

    this.registerFlow.vm$
      .pipe(
        tap((vm) => {
          this.latestVm = vm;
        }),
        filter((vm) => vm.authReady),
        take(1),
        switchMap((vm) => {
          if (!vm.uid) {
            this.router.navigate(['/login'], { replaceUrl: true }).catch(() => {});
            return of(void 0);
          }

          if (vm.currentStep !== 'profileCompletion') {
            this.router.navigateByUrl(vm.nextRoute || '/register/welcome', {
              replaceUrl: true,
            }).catch(() => {});

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
        error: (err) => {
          this.reportError(err, 'Erro ao carregar seus dados. Tente novamente.');
        },
      });
  }

  private loadUserForFormByUid$(uid: string, vm: RegisterFlowVm): Observable<void> {
    return this.profileCompletion.loadUserForFormByUid$(uid, vm).pipe(
      take(1),
      tap((initialData) => {
        if (!initialData) {
          this.setErrorMessage('Não encontramos os dados da sua conta. Tente entrar novamente.');
          this.router.navigate(['/login'], { replaceUrl: true }).catch(() => {});
          return;
        }

        this.email = initialData.email;
        this.nickname = initialData.nickname;

        this.gender = initialData.gender;
        this.orientation = initialData.orientation;
        this.selectedEstado = initialData.estado;
        this.selectedMunicipio = initialData.municipio;

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
        error: (err) => {
          this.reportError(err, 'Erro ao carregar estados.');
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
        error: (err) => {
          this.reportError(err, 'Erro ao carregar municípios.');
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

    this.loadMunicipiosForEstado(this.selectedEstado);
  }

  private resolveSafeRedirectTo(): string | null {
    const raw = String(this.route.snapshot.queryParamMap.get('redirectTo') ?? '').trim();

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

    if (redirectTo) {
      return redirectTo;
    }

    if (vm?.uid === uid && vm.nextRoute && vm.nextRoute !== '/register/finalizar-cadastro') {
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
      this.setWarningMessage('Confirme seu e-mail antes de finalizar o cadastro.');

      this.router.navigate(['/register/welcome'], {
        replaceUrl: true,
        queryParams: { reason: 'email_unverified' },
      }).catch(() => {});

      return false;
    }

    if (vm.currentStep !== 'profileCompletion') {
      this.setWarningMessage('Esta etapa do cadastro não está disponível agora.');

      this.router.navigateByUrl(vm.nextRoute || '/register/welcome', {
        replaceUrl: true,
      }).catch(() => {});

      return false;
    }

    return true;
  }

  onSubmit(): void {
    if (this.isSubmitting) return;

    if (!this.canSubmitProfileCompletion()) {
      return;
    }

    const uid = this.latestVm?.uid?.trim() || null;

    if (!uid) {
      return;
    }

    const vm = this.latestVm;

    if (!vm) {
      return;
    }

    this.checkFieldValidity('gender', this.gender, 'Quero me cadastrar como');
    this.checkFieldValidity('estado', this.selectedEstado, 'Estado');
    this.checkFieldValidity('municipio', this.selectedMunicipio, 'Município');

    if (
      this.isFieldInvalid('gender') ||
      this.isFieldInvalid('estado') ||
      this.isFieldInvalid('municipio')
    ) {
      this.setErrorMessage('Por favor, preencha os campos obrigatórios.');
      return;
    }

    this.isSubmitting = true;
    this.clearSubmitMessages();

    this.profileCompletion
      .saveProfileCompletion$({
        uid,
        vm,
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
        catchError((err) => {
          this.reportError(err, 'Ocorreu um erro ao finalizar o cadastro. Tente novamente.');

          return EMPTY;
        })
      )
      .subscribe({
        next: () => {
          this.setSuccessMessage('Perfil finalizado com sucesso!');

          this.currentUserStore.patch({
            profileCompleted: true,
            gender: this.gender,
            orientation: this.orientation,
            estado: this.selectedEstado,
            municipio: this.selectedMunicipio,
          });

          const target = this.getRedirectToAfterCompletion(uid);
          this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {});
        },
      });
  }

  private uploadAvatarAfterProfileSave$(uid: string): Observable<void> {
    if (!this.avatarFile) {
      return of(void 0);
    }

    this.isUploading = true;
    this.progressValue = 0;
    this.uploadMessage = '';

    return this.profileCompletion
      .uploadProfileAvatarAfterSave$({
        uid,
        file: this.avatarFile,
        onProgress: (progress) => {
          this.isUploading = true;
          this.progressValue = Math.max(0, Math.min(100, Math.round(progress || 0)));
        },
      })
      .pipe(
        tap((result) => {
          if (result.status === 'uploaded' && result.photoURL) {
            this.progressValue = 100;
            this.currentUserStore.patch({ photoURL: result.photoURL });
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
            this.setUploadWarning('Perfil salvo. Não foi possível enviar a foto agora.');
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
      return;
    }

    if (!file.type?.startsWith('image/')) {
      this.setErrorMessage('Selecione uma imagem válida.');
      return;
    }

    const maxSizeBytes = 10 * 1024 * 1024;

    if (file.size > maxSizeBytes) {
      this.setErrorMessage('A foto deve ter no máximo 10 MB.');
      return;
    }

    this.avatarFile = file;
  }

  private resolveEntryContext(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');

    if (reason === 'profile_incomplete') {
      this.entryReason = 'profile_incomplete';
      this.pageTitle = 'Complete seu perfil';
      this.introText = 'Complete os dados abaixo para liberar os recursos básicos da plataforma.';
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
    this.introText = 'Complete os dados abaixo para liberar os recursos básicos da plataforma.';
  }

  checkFieldValidity(field: ProfileCompletionField, value: unknown, label?: string): void {
    const nice = label || field;
    const empty = value === null || value === undefined || String(value).trim() === '';

    this.formErrors[field] = empty ? `O campo "${nice}" é obrigatório.` : '';
  }

  isFieldInvalid(field: ProfileCompletionField): boolean {
    return !!this.formErrors[field];
  }
}
