// src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { EMPTY, Observable, Subject, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import {
  SELECTABLE_PROFILE_IDENTITY_OPTIONS,
  isCoupleProfileIdentityCode,
} from 'src/app/core/domain/profile-identity/profile-identity.catalog';
import { UnsavedChangesAware } from 'src/app/core/guards/unsaved-changes/unsaved-changes.guard';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  ProfileEditEstado,
  ProfileEditLocationService,
  ProfileEditMunicipio,
} from './application/profile-edit-location.service';
import { ProfileEditDraftFacade } from './application/profile-edit-draft.facade';
import { ProfileEditAvatarFacade } from './application/profile-edit-avatar.facade';
import { ProfileEditSaveOrchestrator } from './application/profile-edit-save.orchestrator';

@Component({
  selector: 'app-edit-user-profile',
  templateUrl: './edit-user-profile.component.html',
  styleUrls: ['./edit-user-profile.component.css'],
  providers: [ProfileEditLocationService, ProfileEditDraftFacade, ProfileEditAvatarFacade, ProfileEditSaveOrchestrator],
  standalone: false,
})
export class EditUserProfileComponent
  implements OnInit, OnDestroy, UnsavedChangesAware
{
  userData: IUserDados = {} as IUserDados;
  editForm: FormGroup;

  uid = '';
  estados: ProfileEditEstado[] = [];
  municipios: ProfileEditMunicipio[] = [];

  isSaving = false;

  get progressValue(): number {
    return this.avatarFacade.progress();
  }

  get isEditingPhoto(): boolean {
    return this.avatarFacade.isEditing();
  }

  get isUploading(): boolean {
    return this.avatarFacade.isUploading();
  }

  get imageAccept(): string {
    return this.avatarFacade.imageAccept;
  }

  get imageFormatLabel(): string {
    return this.avatarFacade.imageFormatLabel;
  }

  get avatarMaxMegabytes(): number {
    return this.avatarFacade.avatarMaxMegabytes;
  }

  private readonly destroy$ = new Subject<void>();

  readonly genderOptions = SELECTABLE_PROFILE_IDENTITY_OPTIONS.map((option) => ({
    value: option.code,
    label: option.label,
  }));

  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly formBuilder: FormBuilder,
    private readonly notify: ErrorNotificationService,
    private readonly applicationError: ApplicationErrorService,
    private readonly locationService: ProfileEditLocationService,
    private readonly draftFacade: ProfileEditDraftFacade,
    private readonly avatarFacade: ProfileEditAvatarFacade,
    private readonly saveOrchestrator: ProfileEditSaveOrchestrator
  ) {
    this.editForm = this.formBuilder.group({
      nickname: ['', [Validators.minLength(3)]],
      estado: [''],
      municipio: [{ value: '', disabled: true }],
      gender: [''],
      orientation: [''],
      idade: [null, [Validators.min(18), Validators.max(100)]],
      partner1Orientation: [''],
      partner2Orientation: [''],
      descricao: ['', [Validators.maxLength(2000)]],
    });
  }

  isCouple(): boolean {
    const gender = String(
      this.editForm.get('gender')?.value ?? this.userData.gender ?? ''
    );
    return isCoupleProfileIdentityCode(gender);
  }

  ngOnInit(): void {
    this.uid = String(
      this.route.snapshot.paramMap.get('id') ??
        this.route.snapshot.paramMap.get('uid') ??
        ''
    ).trim();

    if (!this.uid) {
      this.notify.showError(
        'Não foi possível identificar o usuário para edição.'
      );
      this.router.navigate(['/perfil']).catch(() => undefined);
      return;
    }

    this.draftFacade.bind(
      this.editForm,
      this.uid,
      () => this.isSaving
    );

    this.firestoreUserQuery
      .getUser(this.uid)
      .pipe(
        take(1),
        tap((user) => {
          if (!user) throw new Error('Usuário não encontrado.');
          this.userData = user;
        }),
        switchMap((user) =>
          this.locationService.loadEstados$().pipe(
            tap((estados) => (this.estados = estados)),
            switchMap(() =>
              user?.estado ? this.locationService.loadMunicipios$(user.estado) : of([])
            ),
            tap((municipios) => {
              this.municipios = municipios;
              this.syncMunicipioControlState(municipios);
            }),
            tap(() => this.patchFormFromUser(this.userData))
          )
        ),
        catchError((error) =>
          this.handleError$(
            error,
            'init',
            'Falha ao carregar seus dados para edição.'
          )
        ),
        finalize(() => this.draftFacade.restore(this.editForm)),
        takeUntil(this.destroy$)
      )
      .subscribe();

    this.editForm
      .get('gender')!
      .valueChanges.pipe(
        startWith(this.editForm.get('gender')!.value),
        map((value) => String(value ?? '')),
        distinctUntilChanged(),
        tap((gender) => this.syncOrientationControls(gender)),
        takeUntil(this.destroy$)
      )
      .subscribe();

    this.editForm
      .get('estado')!
      .valueChanges.pipe(
        map((value) => String(value ?? '').trim()),
        distinctUntilChanged(),
        switchMap((sigla) =>
          sigla ? this.locationService.loadMunicipios$(sigla) : of([])
        ),
        tap((municipios) => {
          this.municipios = municipios;
          this.syncMunicipioControlState(municipios);

          const selected = String(
            this.editForm.get('municipio')?.value ?? ''
          );

          if (
            selected &&
            municipios.some((municipio) => municipio.nome === selected)
          ) {
            return;
          }

          this.editForm.patchValue(
            { municipio: municipios[0]?.nome ?? '' },
            { emitEvent: false }
          );
        }),
        catchError((error) =>
          this.handleError$(
            error,
            'estadoChange',
            'Falha ao carregar municípios.'
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  hasUnsavedChanges(): boolean {
    return this.draftFacade.hasUnsavedChanges(
      this.editForm,
      this.isSaving
    );
  }

  discardUnsavedChanges(): void {
    this.draftFacade.discard(this.editForm);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.uploadFile(file);
  }

  uploadFile(file: File): void {
    if (!this.uid || this.isUploading || this.isEditingPhoto) return;

    this.avatarFacade
      .upload$(file, this.uid)
      .pipe(takeUntil(this.destroy$))
      .subscribe((imageUrl) => {
        this.userData = {
          ...this.userData,
          photoURL: imageUrl,
        };
      });
  }

  onEstadoChange(_estadoSigla: string): void {
    // Mantido por compatibilidade com templates antigos.
  }

  onSubmit(): void {
    if (this.isSaving) return;

    if (this.isEditingPhoto || this.isUploading) {
      this.notify.showError(
        this.isEditingPhoto
          ? 'Conclua ou cancele a edição da foto antes de salvar.'
          : 'Aguarde o upload da foto terminar antes de salvar.'
      );
      return;
    }

    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.notify.showError(
        'Revise os campos do formulário antes de salvar.'
      );
      return;
    }

    this.isSaving = true;

    this.saveOrchestrator
      .save$(
        this.uid,
        this.editForm.getRawValue(),
        this.isCouple(),
        this.userData.photoURL
      )
      .pipe(
        finalize(() => (this.isSaving = false)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.draftFacade.clearAfterSave(this.editForm);
          this.notify.showSuccess('Perfil atualizado com sucesso.');
          this.router
            .navigate(['/perfil', this.uid])
            .catch(() => undefined);
        },
      });
  }

  private patchFormFromUser(user: IUserDados): void {
    this.editForm.patchValue(
      {
        nickname: user.nickname ?? '',
        estado: user.estado ?? '',
        municipio: user.municipio ?? '',
        gender: user.gender ?? '',
        orientation: user.orientation ?? '',
        idade: user.idade ?? null,
        partner1Orientation: user.partner1Orientation ?? '',
        partner2Orientation: user.partner2Orientation ?? '',
        descricao: user.descricao ?? '',
      },
      { emitEvent: true }
    );
  }

  private syncOrientationControls(gender: string): void {
    const isCouple = isCoupleProfileIdentityCode(gender);

    const orientation = this.editForm.get('orientation')!;
    const partner1 = this.editForm.get('partner1Orientation')!;
    const partner2 = this.editForm.get('partner2Orientation')!;

    if (isCouple) {
      orientation.disable({ emitEvent: false });
      orientation.setValue('', { emitEvent: false });
      partner1.enable({ emitEvent: false });
      partner2.enable({ emitEvent: false });
    } else {
      orientation.enable({ emitEvent: false });
      partner1.disable({ emitEvent: false });
      partner2.disable({ emitEvent: false });
      partner1.setValue('', { emitEvent: false });
      partner2.setValue('', { emitEvent: false });
    }

    partner1.updateValueAndValidity({ emitEvent: false });
    partner2.updateValueAndValidity({ emitEvent: false });
    orientation.updateValueAndValidity({ emitEvent: false });
  }


  private handleError$(
    error: unknown,
    context: string,
    userMessage: string
  ): Observable<never> {
    this.applicationError.report(error, {
      feature: 'profile-edit',
      operation: context,
      fallbackMessage: userMessage,
      metadata: {
        scope: 'EditUserProfileComponent',
      },
    });
    return EMPTY;
  }

  private syncMunicipioControlState(
    municipios: ProfileEditMunicipio[]
  ): void {
    const municipioControl = this.editForm.get('municipio');
    if (!municipioControl) return;

    if (municipios.length > 0) {
      municipioControl.enable({ emitEvent: false });
      return;
    }

    municipioControl.disable({ emitEvent: false });
    municipioControl.patchValue('', { emitEvent: false });
  }
}
