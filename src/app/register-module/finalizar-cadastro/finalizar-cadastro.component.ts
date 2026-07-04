// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
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

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

import { FirestoreUserWriteService } from 'src/app/core/services/data-handling/firestore-user-write.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';
import { ProfileCompletionFacade } from '../data-access/profile-completion.facade';

type ProfileCompletionPayload = Partial<IUserRegistrationData> & Partial<IUserDados>;

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

  public estados: any[] = [];
  public municipios: any[] = [];

  public message = '';
  public isLoading = true;
  public isSubmitting = false;
  public isUploading = false;
  public progressValue = 0;
  public uploadMessage = '';
  public avatarFile: File | null = null;

  public showSubscriptionOptions = false;
  public formErrors: { [key: string]: string } = {};

  private latestVm: RegisterFlowVm | null = null;

  constructor(
    private readonly registerFlow: RegisterFlowFacade,
    private readonly firestoreUserWrite: FirestoreUserWriteService,
    private readonly profileCompletion: ProfileCompletionFacade,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly storageService: StorageService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService
  ) {}

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
          this.globalErrorHandler.handleError(err);
          this.message = 'Erro ao carregar seus dados. Tente novamente.';
          this.errorNotification.showError(this.message);
        },
      });
  }

  private loadUserForFormByUid$(uid: string, vm: RegisterFlowVm): Observable<void> {
    return this.profileCompletion.loadUserForFormByUid$(uid, vm).pipe(
      take(1),
      tap((initialData) => {
        if (!initialData) {
          this.message = 'Não encontramos os dados da sua conta. Tente entrar novamente.';
          this.errorNotification.showError(this.message);
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
          this.globalErrorHandler.handleError(err);
          this.errorNotification.showError('Erro ao carregar estados.');
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
          this.globalErrorHandler.handleError(err);
          this.errorNotification.showError('Erro ao carregar municípios.');
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

  private getRedirectToAfterCompletion(uid: string): string {
    const vm = this.latestVm;

    if (vm?.uid === uid && !vm.adultConsentAccepted) {
      return '/adulto/confirmar';
    }

    const raw = this.route.snapshot.queryParamMap.get('redirectTo');

    if (raw && raw.startsWith('/') && !raw.startsWith('//')) {
      return raw;
    }

    if (vm?.uid === uid && vm.nextRoute && vm.nextRoute !== '/register/finalizar-cadastro') {
      return vm.nextRoute;
    }

    return `/perfil/${uid}`;
  }

  private canSubmitProfileCompletion(): boolean {
    const vm = this.latestVm;

    if (!vm?.uid) {
      const msg = 'Erro: UID do usuário não encontrado.';
      this.message = msg;
      this.errorNotification.showError(msg);
      return false;
    }

    if (!vm.emailVerified) {
      const msg = 'Confirme seu e-mail antes de finalizar o cadastro.';
      this.message = msg;
      this.errorNotification.showWarning(msg);

      this.router.navigate(['/register/welcome'], {
        replaceUrl: true,
        queryParams: { reason: 'email_unverified' },
      }).catch(() => {});

      return false;
    }

    if (vm.currentStep !== 'profileCompletion') {
      const msg = 'Esta etapa do cadastro não está disponível agora.';
      this.message = msg;
      this.errorNotification.showWarning(msg);

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
      const msg = 'Por favor, preencha os campos obrigatórios.';
      this.message = msg;
      this.errorNotification.showError(msg);
      return;
    }

    this.isSubmitting = true;
    this.message = '';
    this.uploadMessage = '';

this.profileCompletion
  .loadUserForFormByUid$(uid, vm)
  .pipe(
    take(1),
    switchMap((existingUserData) => {
      if (!existingUserData) {
        throw new Error('Dados do usuário não encontrados.');
      }

      const completionPayload: ProfileCompletionPayload = {
        uid,
        nickname: existingUserData.nickname || '',
        gender: this.gender || existingUserData.gender || '',
        orientation: this.orientation || existingUserData.orientation || '',
        estado: this.selectedEstado || existingUserData.estado || '',
        municipio: this.selectedMunicipio || existingUserData.municipio || '',
        profileCompleted: true,
      };

      return this.firestoreUserWrite
        .saveInitialUserData$(uid, completionPayload)
        .pipe(
          switchMap(() => this.uploadAvatarAfterProfileSave$(uid)),
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

    return this.storageService
      .uploadProfileAvatar(this.avatarFile, uid, (progress) => {
        this.isUploading = true;
        this.progressValue = Math.max(0, Math.min(100, Math.round(progress || 0)));
      })
      .pipe(
        switchMap((photoURL) => {
          if (!photoURL) return of(void 0);

          return this.firestoreUserWrite.patchProfileAvatar$(uid, photoURL).pipe(
            tap(() => {
              this.currentUserStore.patch({ photoURL });
            }),
            catchError(() => {
              this.uploadMessage =
                'Perfil salvo. A foto foi enviada, mas não foi possível atualizar o avatar agora.';
              this.errorNotification.showWarning(this.uploadMessage);
              return of(void 0);
            })
          );
        }),
        tap(() => {
          this.progressValue = 100;
        }),
        catchError(() => {
          this.uploadMessage = 'Perfil salvo. Não foi possível enviar a foto agora.';
          this.errorNotification.showWarning(this.uploadMessage);
          return of(void 0);
        }),
        finalize(() => {
          this.isUploading = false;
        }),
        map(() => void 0)
      );
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

  checkFieldValidity(field: string, value: unknown, label?: string): void {
    const nice = label || field;
    const empty = value === null || value === undefined || String(value).trim() === '';

    this.formErrors[field] = empty ? `O campo "${nice}" é obrigatório.` : '';
  }

  isFieldInvalid(field: string): boolean {
    return !!this.formErrors[field];
  }

  goToSubscription(): void {
    this.router.navigate(['/subscription-plan']).catch(() => {});
  }

  continueWithoutSubscription(): void {
    const uid = this.latestVm?.uid;

    if (uid && !this.latestVm?.adultConsentAccepted) {
      this.router.navigate(['/adulto/confirmar'], { replaceUrl: true }).catch(() => {});
      return;
    }

    this.router.navigate(['/dashboard/principal']).catch(() => {});
  }
}
