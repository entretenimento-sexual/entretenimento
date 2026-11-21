// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  HostListener,
  OnInit,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

import { EMPTY, Observable, Subject, TimeoutError, defer, merge, of, throwError } from 'rxjs';
import {
  catchError,
  debounceTime,
  filter,
  finalize,
  map,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  SELECTABLE_PROFILE_IDENTITY_OPTIONS,
  isCoupleProfileIdentityCode,
  isSelectableProfileIdentityCode,
} from 'src/app/core/domain/profile-identity/profile-identity.catalog';
import { PROFILE_ORIENTATION_OPTIONS, coupleOrientationLabels } from 'src/app/core/domain/profile-identity/profile-orientation.catalog';
import { UnsavedChangesAware } from 'src/app/core/guards/unsaved-changes/unsaved-changes.guard';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { LocalDraftService } from 'src/app/core/services/drafts/local-draft.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type {
  IbgeMunicipio,
  IbgeUF,
} from 'src/app/core/services/general/api/ibge-location.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_IMAGE_FORMAT_LABEL,
  resolveImageMaxBytes,
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { NetworkStatusService } from 'src/app/core/services/network/network-status.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import {
  PROFILE_COMPLETED_NAVIGATION_INFO,
  REGISTRATION_COMPLETION_ROUTE,
  resolveRegistrationReturnUrl,
  type RegisterFlowVm,
} from '../data-access/register-flow.model';
import { ProfileCompletionFacade } from '../data-access/profile-completion.facade';
import {
  isRegistrationConfirmationUncertain,
  isRegistrationSessionChange,
  REGISTRATION_ACTION_TIMEOUT_MS,
} from '../data-access/register-action.policy';

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
  estado: string;
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
  private readonly injector = inject(Injector);
  private readonly stepHeading = viewChild<ElementRef<HTMLHeadingElement>>('stepHeading');
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly networkStatus = inject(NetworkStatusService);
  private readonly draftChanges$ = new Subject<void>();
  private readonly municipiosRequests$ = new Subject<string>();
  private savedProfileDestination: { uid: string; target: string } | null = null;
  public openingSavedProfile = false;
  public savedProfileNavigationFailed = false;
  public profileDataUnavailable = false;
  public loadingEstados = false;
  public loadingMunicipios = false;
  public estadosUnavailable = false;
  public municipiosUnavailable = false;

  get profileSaved(): boolean {
    return this.savedProfileDestination !== null;
  }

  public entryReason: 'profile_incomplete' | 'email_unverified' | null = null;
  protected draftSaved = false;

  get pageTitle(): string {
    if (this.isLoading || this.profileDataUnavailable) return 'Complete seu perfil';
    if (this.profileStep === 'orientation') {
      return this.isCouple ? 'Querem acrescentar suas orientações?' : 'Quer acrescentar sua orientação?';
    }
    if (this.profileStep === 'location') return 'Em que cidade você está?';
    if (this.profileStep === 'review') return 'Seu perfil está quase pronto';
    const nicknameValid = this.isNicknameValid(this.nickname) && !this.isFieldInvalid('nickname');
    if (this.needsNickname && !nicknameValid) return 'Como você quer aparecer?';
    if (!isSelectableProfileIdentityCode(this.gender)) {
      const nickname = nicknameValid ? this.nicknameMain.trim() : '';
      return nickname ? `${nickname}, como você se identifica?` : 'Como você se identifica?';
    }
    return 'Como você se identifica?';
  }

  public email = '';
  public nicknameMain = '';
  public nicknameComplement = '';
  readonly nicknameMaxLength = NicknameUtils.DISPLAY_PART_MAX_LEN;
  public needsNickname = false;

  get nickname(): string {
    return NicknameUtils.montarApelidoCompleto(this.nicknameMain, this.nicknameComplement);
  }

  set nickname(value: string) {
    const [main, ...complement] = NicknameUtils.normalizarApelido(value).split(' ');
    this.nicknameMain = main;
    this.nicknameComplement = complement.join(' ');
  }

  get showIdentity(): boolean {
    return !this.needsNickname || this.isNicknameValid(this.nickname) || !!this.gender;
  }

  profileStep: 'identity' | 'orientation' | 'location' | 'review' = 'identity';
  private stepAfterIdentity: 'orientation' | 'location' | 'review' = 'orientation';

  get identityLabel(): string {
    return this.identityOptions.find(({ code }) => code === this.gender)?.label ?? '';
  }

  get isCouple(): boolean {
    return isCoupleProfileIdentityCode(this.gender);
  }

  get partnerOrientationLabels(): readonly [string, string] {
    return coupleOrientationLabels(this.gender);
  }

  get hasOrientationSelection(): boolean {
    return this.isCouple
      ? !!(this.partner1Orientation || this.partner2Orientation)
      : !!this.orientation;
  }

  onGenderChange(gender: string): void {
    const compositionChanged = this.gender !== gender &&
      (this.isCouple || isCoupleProfileIdentityCode(gender));
    this.gender = gender;
    if (compositionChanged) {
      this.clearOrientationChoices();
      this.stepAfterIdentity = 'orientation';
    }
    this.checkFieldValidity('gender', gender, 'Identificação do perfil');
  }

  private clearOrientationChoices(): void {
    this.orientation = '';
    this.showOrientationPublicly = false;
    this.partner1Orientation = '';
    this.partner2Orientation = '';
  }

  get orientationLabel(): string {
    return this.orientationOptions.find(({ code }) => code === this.orientation)?.label ?? '';
  }

  editIdentity(): void {
    if (this.profileStep === 'identity') return;
    this.stepAfterIdentity = this.profileStep;
    this.openProfileStep('identity');
  }

  editOrientation(): void {
    this.openProfileStep('orientation');
  }

  editLocation(): void {
    this.openProfileStep('location');
  }

  onOrientationChange(value: string): void {
    this.orientation = value;
    if (!value) this.showOrientationPublicly = false;
  }

  advanceProfileStep(): void {
    if (this.isSubmitting || this.isEditingAvatar) return;
    switch (this.profileStep) {
      case 'identity':
        if (this.needsNickname) this.checkFieldValidity('nickname', this.nickname, 'Apelido');
        if (this.isFieldInvalid('nickname')) return;
        this.checkFieldValidity('gender', this.gender, 'Identificação do perfil');
        if (!isSelectableProfileIdentityCode(this.gender)) return;
        this.persistUnsavedChanges();
        this.openProfileStep(this.stepAfterIdentity);
        return;
      case 'orientation':
        this.openProfileStep('location');
        return;
      case 'location':
        this.checkFieldValidity('estado', this.selectedEstado, 'Estado');
        if (!this.loadingMunicipios && this.municipios.length) {
          this.checkFieldValidity('municipio', this.selectedMunicipio, 'Município');
        }
        if (this.showCompletionActions) this.openProfileStep('review');
        return;
      case 'review':
        this.onSubmit();
    }
  }

  private openProfileStep(step: typeof this.profileStep): void {
    if (this.isSubmitting || this.isEditingAvatar) return;
    this.profileStep = step;
    afterNextRender(() => this.stepHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  get showCompletionActions(): boolean {
    return (!this.needsNickname || this.isNicknameValid(this.nickname)) &&
      isSelectableProfileIdentityCode(this.gender) && !!this.selectedEstado &&
      this.municipios.some(({ nome }) => nome === this.selectedMunicipio);
  }

  get nicknameMainValid(): boolean {
    const main = this.nicknameMain.trim();
    return !/\s/.test(main) && NicknameUtils.isApelidoDeCadastroValido(main);
  }

  public readonly identityOptions = SELECTABLE_PROFILE_IDENTITY_OPTIONS;
  public readonly orientationOptions = PROFILE_ORIENTATION_OPTIONS;
  public readonly avatarAccept = MEDIA_IMAGE_ACCEPT;
  public readonly avatarFormatLabel = MEDIA_IMAGE_FORMAT_LABEL;
  public readonly avatarMaxMegabytes = resolveImageMaxBytes('avatar') / 1024 / 1024;
  public gender = '';
  public orientation = '';
  public partner1Orientation = '';
  public partner2Orientation = '';
  public showOrientationPublicly = false;
  public selectedEstado = '';
  public selectedMunicipio = '';

  public estados: IbgeUF[] = [];
  public municipios: IbgeMunicipio[] = [];

  public message = '';
  public messageKind: ProfileCompletionMessageKind = null;
  protected termsReviewRequired = false;
  public isLoading = true;
  public isSubmitting = false;
  public confirmingProfile = false;
  public isUploading = false;
  public isEditingAvatar = false;
  public progressValue = 0;
  public uploadMessage = '';
  public avatarFile: File | null = null;

  public formErrors: Partial<Record<ProfileCompletionField, string>> = {};

  protected latestVm: RegisterFlowVm | null = null;
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
    private readonly errorNotification: ErrorNotificationService,
    private readonly photoEditor: PhotoEditorLauncherService
  ) {}

  ngOnInit(): void {
    this.resolveEntryContext();
    this.observeMunicipiosRequests();
    this.loadEstados();
    this.observeDraftChanges();
    this.loadProfile();
  }

  loadProfile(): void {
    this.isLoading = true;
    this.profileDataUnavailable = false;
    this.clearSubmitMessages();
    this.registerFlow.vm$
      .pipe(
        tap((vm) => {
          this.latestVm = vm;
        }),
        filter((vm) => vm.authReady && vm.currentStep !== 'loading'),
        take(1),
        switchMap((vm) => {
          if (!vm.uid) {
            return this.router.navigate(['/login'], { replaceUrl: true }).then((opened) => {
              if (!opened) throw new Error('A tela de login não abriu.');
            });
          }

          if (vm.currentStep !== 'profileCompletion') {
            return this.router.navigateByUrl(vm.nextRoute || '/register/welcome', {
              replaceUrl: true,
            }).then((opened) => {
              if (!opened) throw new Error('A próxima etapa do cadastro não abriu.');
            });
          }

          return this.loadUserForFormByUid$(vm.uid, vm);
        }),
        timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
        finalize(() => {
          this.isLoading = false;
          this.changeDetector.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        error: (error) => {
          this.profileDataUnavailable = true;
          this.reportError(
            error,
            'Não foi possível carregar os dados do perfil. Verifique a conexão e tente carregar novamente.'
          );
        },
      });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    this.persistUnsavedChanges();
    event.preventDefault();
    event.returnValue = '';
  }

  hasUnsavedChanges(): boolean {
    if (!this.draftReady || this.isSubmitting || this.profileSaved) return false;
    return (
      this.currentDraftSnapshot() !== this.initialDraftSnapshot ||
      this.avatarFile !== null
    );
  }

  discardUnsavedChanges(): void {
    this.localDraft.remove(this.draftKey);
    this.draftSaved = false;
    this.initialDraftSnapshot = this.currentDraftSnapshot();
    this.avatarFile = null;
  }

  persistUnsavedChanges(): void {
    if (!this.hasUnsavedChanges()) return;
    this.draftSaved = this.localDraft.save(this.draftKey, this.currentDraftValue());
    this.changeDetector.markForCheck();
  }

  onDraftChange(): void {
    if (!this.draftReady || this.isSubmitting) return;
    this.draftChanges$.next();
  }

  private clearSubmitMessages(): void {
    this.message = '';
    this.messageKind = null;
    this.termsReviewRequired = false;
    this.uploadMessage = '';
  }

  private setErrorMessage(message: string): void {
    this.message = message;
    this.messageKind = 'error';
    this.changeDetector.markForCheck();
  }

  private setWarningMessage(message: string): void {
    this.message = message;
    this.messageKind = 'warning';
    this.changeDetector.markForCheck();
  }

  private setSuccessMessage(message: string): void {
    this.message = message;
    this.messageKind = 'success';
    this.changeDetector.markForCheck();
    this.errorNotification.showSuccess(message);
  }

  private normalizeReportableError(error: unknown): ReportableError {
    if (error instanceof Error || error instanceof HttpErrorResponse) {
      return error;
    }
    if (typeof error === 'string' && error.trim()) {
      return new Error(error.trim());
    }
    return new Error('[FinalizarCadastroComponent] Erro desconhecido.');
  }

  private reportError(error: unknown, message: string): void {
    const reportable = this.normalizeReportableError(error);
    (reportable as ReportableError & { skipUserNotification?: boolean })
      .skipUserNotification = true;
    this.globalErrorHandler.handleError(reportable);
    this.setErrorMessage(message);
  }

  private setUploadWarning(message: string): void {
    this.uploadMessage = message;
    this.changeDetector.markForCheck();
  }

  private resetAvatarUploadState(): void {
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
        if (!this.isCurrentAccount(uid)) {
          this.profileDataUnavailable = true;
          this.setErrorMessage('A conta ativa mudou. Recarregue a página para retomar o cadastro.');
          return;
        }
        if (!initialData) {
          this.profileDataUnavailable = true;
          this.setErrorMessage(
            'Os dados da sua conta ainda não apareceram. Tente carregar novamente ou entre com a mesma conta.'
          );
          return;
        }

        this.email = initialData.email;
        const reservedNickname = NicknameUtils.normalizarApelido(initialData.nickname);
        this.needsNickname = !reservedNickname;
        this.nickname = reservedNickname || NicknameUtils.normalizarApelido(initialData.savedNicknameSuggestion ?? '');
        this.gender = initialData.gender;
        this.orientation = this.isCouple ? '' : initialData.orientation;
        this.showOrientationPublicly = !this.isCouple && initialData.showOrientationPublicly === true;
        this.partner1Orientation = this.isCouple ? initialData.partner1Orientation ?? '' : '';
        this.partner2Orientation = this.isCouple ? initialData.partner2Orientation ?? '' : '';
        this.selectedEstado = initialData.estado;
        this.selectedMunicipio = initialData.municipio;

        this.initializeDraftState(uid);
        this.profileStep = this.selectedEstado && this.isNicknameValid(this.nickname) &&
          isSelectableProfileIdentityCode(this.gender)
          ? (this.isCouple ? 'orientation' : 'location')
          : 'identity';
        this.stepAfterIdentity = 'orientation';
        if (this.selectedEstado) {
          this.loadMunicipiosForEstado(this.selectedEstado);
        }
      }),
      map(() => void 0)
    );
  }

  loadEstados(): void {
    if (this.loadingEstados) return;
    this.loadingEstados = true;
    this.estadosUnavailable = false;
    this.profileCompletion
      .getEstados$()
      .pipe(
        take(1),
        timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
        catchError(() => of([])),
        finalize(() => {
          this.loadingEstados = false;
          this.changeDetector.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (estados) => {
          this.estados = estados;
          this.estadosUnavailable = !estados.length;
        },
      });
  }

  private loadMunicipiosForEstado(estado: string): void {
    this.municipiosRequests$.next(estado);
  }

  private observeMunicipiosRequests(): void {
    this.municipiosRequests$.pipe(
      switchMap((estado) => {
        this.municipios = [];
        this.loadingMunicipios = !!estado;
        this.municipiosUnavailable = false;
        if (!estado) return EMPTY;

        return this.profileCompletion.getMunicipios$(estado).pipe(
          take(1),
          timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
          catchError(() => of([])),
          finalize(() => {
            this.loadingMunicipios = false;
            this.changeDetector.markForCheck();
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((municipios) => {
      this.municipios = municipios;
      this.municipiosUnavailable = !municipios.length;
    });
  }

  retryMunicipios(): void {
    this.loadMunicipiosForEstado(this.selectedEstado);
  }

  onEstadoChange(): void {
    this.selectedMunicipio = '';
    delete this.formErrors.municipio;
    this.loadMunicipiosForEstado(this.selectedEstado);
    this.checkFieldValidity('estado', this.selectedEstado, 'Estado');
  }

  protected getRedirectToAfterCompletion(): string {
    return resolveRegistrationReturnUrl(this.route.snapshot.queryParamMap.get('redirectTo')) ??
      REGISTRATION_COMPLETION_ROUTE;
  }

  private opensPreferences(target: string): boolean {
    const path = target.split(/[?#;]/, 1)[0];
    return path === REGISTRATION_COMPLETION_ROUTE || path.startsWith(REGISTRATION_COMPLETION_ROUTE + '/');
  }

  private canSubmitProfileCompletion(): boolean {
    const vm = this.latestVm;
    if (!vm?.uid) {
      this.setErrorMessage('Erro: UID do usuário não encontrado.');
      return false;
    }
    if (!vm.emailVerified) {
      this.setWarningMessage('Confirme seu e-mail antes de finalizar o cadastro.');
      this.router
        .navigate(['/register/welcome'], {
          replaceUrl: true,
          queryParams: { reason: 'email_unverified' },
        })
        .catch(() => {});
      return false;
    }
    if (vm.currentStep !== 'profileCompletion') {
      this.setWarningMessage('Esta etapa do cadastro não está disponível agora.');
      this.router
        .navigateByUrl(vm.nextRoute || '/register/welcome', { replaceUrl: true })
        .catch(() => {});
      return false;
    }
    return true;
  }

  onSubmit(): void {
    if (this.profileSaved || this.isLoading || this.profileDataUnavailable ||
        this.isSubmitting || this.isEditingAvatar) return;
    if (!this.canSubmitProfileCompletion()) return;

    const uid = this.latestVm?.uid?.trim() || null;
    const vm = this.latestVm;
    if (!uid || !vm) return;
    if (!this.isCurrentAccount(uid)) {
      this.setErrorMessage('A conta ativa mudou. Recarregue a página para retomar o cadastro.');
      return;
    }

    const fields = [
      ['nickname', this.nickname, 'Apelido'],
      ['gender', this.gender, 'Identificação do perfil'],
      ['estado', this.selectedEstado, 'Estado'],
      ['municipio', this.selectedMunicipio, 'Município'],
    ] as const;
    for (const [field, value, label] of fields) {
      if (field === 'municipio' && this.loadingMunicipios) return;
      this.checkFieldValidity(field, value, label);
      if (this.isFieldInvalid(field)) return;
    }

    this.persistUnsavedChanges();
    this.isSubmitting = true;
    this.clearSubmitMessages();

    this.profileCompletion
      .saveProfileCompletion$({
        uid,
        vm,
        nickname: NicknameUtils.normalizarApelido(this.nickname),
        gender: this.gender,
        orientation: this.orientation,
        showOrientationPublicly: !!this.orientation && this.showOrientationPublicly,
        ...(this.isCouple ? {
          partner1Orientation: this.partner1Orientation,
          partner2Orientation: this.partner2Orientation,
        } : {}),
        estado: this.selectedEstado,
        municipio: this.selectedMunicipio,
      })
      .pipe(
        take(1),
        timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
        catchError((error) => {
          if (!isRegistrationConfirmationUncertain(error) || !this.isCurrentAccount(uid)) {
            return throwError(() => error);
          }

          return this.confirmProfileAfterUncertainSave$(uid).pipe(
            switchMap((confirmed) => confirmed ? of(void 0) : throwError(() => error))
          );
        }),
        switchMap(() => this.isCurrentAccount(uid)
          ? defer(() => this.uploadAvatarAfterProfileSave$(uid)).pipe(
            timeout({ first: 60_000 }),
            catchError((error: unknown) => {
              if (this.isCurrentAccount(uid)) {
                this.setUploadWarning(error instanceof TimeoutError
                  ? 'Seu perfil foi salvo. O envio da foto ainda não foi confirmado. Você pode conferir ou adicionar a foto ao editar o perfil.'
                  : 'Não foi possível enviar a foto. Você pode adicioná-la ao editar o perfil.');
              }
              this.globalErrorHandler.handleError(Object.assign(
                new Error('Falha no envio da foto após salvar o perfil.', { cause: error }),
                { skipUserNotification: true }
              ));
              return of(void 0);
            })
          )
          : of(void 0)
        ),
        map(() => void 0),
        finalize(() => {
          this.isSubmitting = false;
          this.changeDetector.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          const code = String((error as { code?: unknown } | null)?.code ?? '');
          if (isRegistrationSessionChange(error) || !this.isCurrentAccount(uid)) {
            this.setErrorMessage('A conta ativa mudou. Recarregue a página para retomar o cadastro.');
            return EMPTY;
          }
          const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
          if (reason === 'terms_required') {
            this.termsReviewRequired = true;
            this.setWarningMessage('Revise os Termos de Uso e o Aviso de Privacidade vigentes para concluir o perfil.');
            return EMPTY;
          }
          if (reason === 'account_interaction_blocked') {
            this.setWarningMessage('Sua conta está com uma restrição. Consulte o status da conta para saber como continuar.');
            return EMPTY;
          }
          if (reason === 'trusted_age_verification_required') {
            this.setWarningMessage('Sua maioridade ainda precisa ser verificada para concluir o cadastro.');
            return EMPTY;
          }
          if (code === 'nickname/in-use' || code === 'functions/already-exists') {
            this.formErrors['nickname'] = 'Este apelido já está em uso.';
            this.setErrorMessage('Escolha outro apelido para continuar.');
            return EMPTY;
          }
          if (code === 'nickname/invalid') {
            this.formErrors['nickname'] = 'Informe um apelido válido.';
            this.setErrorMessage('Revise o apelido informado.');
            return EMPTY;
          }
          this.reportError(
            error,
            isRegistrationConfirmationUncertain(error)
              ? 'Ainda não foi possível confirmar se o perfil foi salvo. Verifique a conexão e tente novamente ou entre com a mesma conta para conferir.'
              : 'Não foi possível finalizar o cadastro. Revise os dados e tente novamente.'
          );
          return EMPTY;
        })
      )
      .subscribe({
        next: () => {
          if (!this.isCurrentAccount(uid)) {
            this.setErrorMessage('A conta ativa mudou. Confira o cadastro na conta usada para salvar o perfil.');
            return;
          }

          const target = this.getRedirectToAfterCompletion();
          if (!this.uploadMessage && !this.opensPreferences(target)) {
            this.setSuccessMessage('Perfil finalizado com sucesso!');
          }
          this.localDraft.remove(this.draftKey);
          this.initialDraftSnapshot = this.currentDraftSnapshot();
          this.avatarFile = null;
          this.savedProfileDestination = { uid, target };
          if (!this.uploadMessage) this.continueAfterProfileSave();
        },
      });
  }

  private isCurrentAccount(uid: string): boolean {
    return this.currentUserStore.getLoggedUserUIDSnapshot() === uid;
  }

  private confirmProfileAfterUncertainSave$(uid: string): Observable<boolean> {
    this.confirmingProfile = true;
    this.changeDetector.markForCheck();

    const accountChanged$ = this.currentUserStore.getLoggedUserUID$().pipe(
      filter((currentUid) => currentUid !== uid),
      map(() => false)
    );
    const confirmation$ = this.networkStatus.isOnline$.pipe(
      filter((online) => online),
      take(1),
      switchMap(() => this.isCurrentAccount(uid)
        ? this.profileCompletion.confirmProfileCompletion$(uid)
        : of(false)
      )
    );

    return merge(accountChanged$, confirmation$).pipe(
      take(1),
      timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
      catchError(() => of(false)),
      finalize(() => {
        this.confirmingProfile = false;
        this.changeDetector.markForCheck();
      })
    );
  }

  continueAfterProfileSave(): void {
    const saved = this.savedProfileDestination;
    if (!saved || this.openingSavedProfile || !this.isCurrentAccount(saved.uid)) return;

    this.openingSavedProfile = true;
    this.savedProfileNavigationFailed = false;
    const navigation = this.opensPreferences(saved.target)
      ? { replaceUrl: true, info: PROFILE_COMPLETED_NAVIGATION_INFO }
      : { replaceUrl: true };
    const confirm$ = defer(() => {
      const user = this.currentUserStore.getSnapshot();
      return user?.uid === saved.uid && user.profileCompleted === true
        ? of(true) : this.profileCompletion.confirmProfileCompletion$(saved.uid);
    });
    confirm$.pipe(
      take(1),
      timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
      switchMap(confirmed => {
        if (!this.isCurrentAccount(saved.uid)) return EMPTY;
        return confirmed ? defer(() => this.router.navigateByUrl(saved.target, navigation)) : of(false);
      }),
      timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
      tap((navigated) => {
        if (!navigated || this.router.url.split(/[?#]/)[0] === '/register/finalizar-cadastro') {
          throw new Error('A próxima tela não abriu após salvar o perfil.');
        }
      }),
      catchError((error: unknown) => {
        if (this.isCurrentAccount(saved.uid)) this.savedProfileNavigationFailed = true;
        this.globalErrorHandler.handleError(Object.assign(
          new Error('Não foi possível abrir a próxima tela após salvar o perfil.', { cause: error }),
          { skipUserNotification: true }
        ));
        return EMPTY;
      }),
      finalize(() => {
        this.openingSavedProfile = false;
        this.changeDetector.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private uploadAvatarAfterProfileSave$(uid: string): Observable<void> {
    if (!this.avatarFile) return of(void 0);

    const validation = validateImageMediaFile(this.avatarFile, 'avatar');
    if (!validation.valid) {
      return new Observable<void>((subscriber) => {
        subscriber.error(
          new Error(validation.userMessage ?? 'A foto principal não é válida.')
        );
      });
    }

    this.isUploading = true;
    this.progressValue = 0;
    this.uploadMessage = '';
    this.changeDetector.markForCheck();

    return this.profileCompletion
      .uploadProfileAvatarAfterSave$({
        uid,
        file: this.avatarFile,
        onProgress: (progress) => {
          if (!this.isCurrentAccount(uid)) return;
          this.isUploading = true;
          this.progressValue = Math.max(
            0,
            Math.min(100, Math.round(progress || 0))
          );
          this.changeDetector.markForCheck();
        },
      })
      .pipe(
        tap((result) => {
          if (!this.isCurrentAccount(uid)) return;
          if (result.status === 'uploaded' && result.photoURL) {
            this.progressValue = 100;
            this.currentUserStore.patch({ photoURL: result.photoURL });
            return;
          }
          if (result.status === 'avatar_patch_failed') {
            this.progressValue = 100;
            this.setUploadWarning(
              'A foto foi enviada, mas o avatar não foi atualizado. Você pode tentar de novo ao editar o perfil.'
            );
            return;
          }
          if (result.status === 'upload_failed') {
            this.setUploadWarning('Não foi possível enviar a foto. Você pode adicioná-la ao editar o perfil.');
          }
        }),
        finalize(() => {
          this.isUploading = false;
          this.changeDetector.markForCheck();
        }),
        map(() => void 0)
      );
  }

  uploadFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    this.resetAvatarUploadState();
    if (!file || this.isEditingAvatar) {
      if (input) input.value = '';
      return;
    }

    const validation = validateImageMediaFile(file, 'avatar');
    if (!validation.valid) {
      this.setErrorMessage(
        validation.userMessage ?? 'Selecione uma foto principal válida.'
      );
      if (input) input.value = '';
      return;
    }

    this.isEditingAvatar = true;
    this.photoEditor
      .editFile$(file, {
        source: 'profile-avatar',
        context: 'profile-avatar',
        preset: 'avatar-square',
      })
      .pipe(
        take(1),
        tap((result) => {
          if (!result) return;
          const processedValidation = validateImageMediaFile(result.file, 'avatar');
          if (!processedValidation.valid) {
            throw new Error(
              processedValidation.userMessage ??
                'A imagem editada não atende à política de avatar.'
            );
          }
          this.avatarFile = result.file;
          this.message = '';
          this.messageKind = null;
          this.onDraftChange();
        }),
        catchError((error) => {
          this.reportError(
            error,
            'Não foi possível preparar a foto principal. Tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isEditingAvatar = false;
          if (input) input.value = '';
          this.changeDetector.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private initializeDraftState(uid: string): void {
    this.draftKey = `profile-completion:${uid}`;
    this.initialDraftSnapshot = this.currentDraftSnapshot();

    const draft = this.localDraft.load<ProfileCompletionDraft>(this.draftKey);
    this.draftSaved = draft !== null;
    if (draft) {
      if (this.needsNickname) {
        this.nickname = draft.nickname || this.nickname;
      }
      if (this.gender !== draft.gender && (this.isCouple || isCoupleProfileIdentityCode(draft.gender))) {
        this.clearOrientationChoices();
      }
      this.gender = String(draft.gender ?? '');
      if (draft.estado !== this.selectedEstado) this.selectedMunicipio = '';
      this.selectedEstado = draft.estado;
    }
    this.draftReady = true;
  }

  private observeDraftChanges(): void {
    this.draftChanges$
      .pipe(
        debounceTime(500),
        tap(() => this.persistUnsavedChanges()),
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
      estado: String(this.selectedEstado ?? '').trim(),
    };
  }

  private currentDraftSnapshot(): string {
    // O alerta de alterações inclui os campos que só existem no formulário.
    return JSON.stringify({
      ...this.currentDraftValue(),
      orientation: this.orientation.trim(),
      partner1Orientation: this.partner1Orientation,
      partner2Orientation: this.partner2Orientation,
      showOrientationPublicly: this.showOrientationPublicly,
      municipio: this.selectedMunicipio.trim(),
    });
  }

  private resolveEntryContext(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');
    this.entryReason = reason === 'profile_incomplete' || reason === 'email_unverified' ? reason : null;
  }

  onNicknameChange(): void {
    if (this.isFieldInvalid('nickname')) {
      this.checkFieldValidity('nickname', this.nickname);
      return;
    }
    this.onDraftChange();
  }

  private isNicknameValid(display: string): boolean {
    return this.needsNickname
      ? this.nicknameMainValid && !/\s/.test(this.nicknameComplement.trim()) &&
        NicknameUtils.isApelidoDeCadastroValido(display)
      : NicknameUtils.isApelidoValido(display) && NicknameUtils.isApelidoIndiceValido(display);
  }

  checkFieldValidity(
    field: ProfileCompletionField,
    value: unknown,
    label?: string
  ): void {
    const nice = label || field;
    const clean = String(value ?? '').trim();

    if (field === 'nickname') {
      this.formErrors[field] = this.isNicknameValid(clean)
        ? ''
        : 'Use de 4 a 12 caracteres no apelido e até 12 no complemento. São aceitos letras sem acento, números, ponto, hífen e sublinhado.';
      this.onDraftChange();
      return;
    }

    if (field === 'gender') {
      this.formErrors[field] = isSelectableProfileIdentityCode(clean)
        ? ''
        : 'Selecione uma identificação de perfil válida.';
      this.onDraftChange();
      return;
    }

    this.formErrors[field] = clean ? '' : `O campo "${nice}" é obrigatório.`;
    if (field === 'municipio' && clean && !this.municipios.some(({ nome }) => nome === clean)) {
      this.formErrors[field] = 'Selecione um município da lista do estado escolhido.';
    }
    this.onDraftChange();
  }

  isFieldInvalid(field: ProfileCompletionField): boolean {
    return !!this.formErrors[field];
  }
}
