// src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Router } from '@angular/router';

import { Subject } from 'rxjs';
import {
  finalize,
  takeUntil,
} from 'rxjs/operators';

import { UnsavedChangesAware } from 'src/app/core/guards/unsaved-changes/unsaved-changes.guard';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  ProfileEditEstado,
  ProfileEditLocationService,
} from './application/profile-edit-location.service';
import { ProfileEditDraftFacade } from './application/profile-edit-draft.facade';
import { ProfileEditAvatarFacade } from './application/profile-edit-avatar.facade';
import { ProfileEditSaveOrchestrator } from './application/profile-edit-save.orchestrator';
import { ProfileEditBootstrapFacade } from './application/profile-edit-bootstrap.facade';
import { ProfileEditFormFacade } from './application/profile-edit-form.facade';

@Component({
  selector: 'app-edit-user-profile',
  templateUrl: './edit-user-profile.component.html',
  styleUrls: ['./edit-user-profile.component.css'],
  providers: [ProfileEditLocationService, ProfileEditDraftFacade, ProfileEditAvatarFacade, ProfileEditSaveOrchestrator, ProfileEditBootstrapFacade, ProfileEditFormFacade],
  standalone: false,
})
export class EditUserProfileComponent
  implements OnInit, OnDestroy, UnsavedChangesAware
{
  userData: IUserDados = {} as IUserDados;
  readonly editForm: FormGroup;

  uid = '';
  estados: ProfileEditEstado[] = [];

  get municipios() {
    return this.formFacade.municipios();
  }

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

  get genderOptions() {
    return this.formFacade.genderOptions;
  }

  constructor(
    private readonly router: Router,
    private readonly notify: ErrorNotificationService,
    private readonly locationService: ProfileEditLocationService,
    private readonly draftFacade: ProfileEditDraftFacade,
    private readonly avatarFacade: ProfileEditAvatarFacade,
    private readonly saveOrchestrator: ProfileEditSaveOrchestrator,
    private readonly bootstrapFacade: ProfileEditBootstrapFacade,
    private readonly formFacade: ProfileEditFormFacade
  ) {
    this.editForm = this.formFacade.form;
  }

  isCouple(): boolean {
    return this.formFacade.isCouple();
  }

  ngOnInit(): void {
    this.bootstrapFacade
      .load$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((vm) => {
        this.uid = vm.uid;
        this.userData = vm.user;
        this.estados = vm.estados;
        this.formFacade.initialize(vm.user, vm.municipios);

        this.draftFacade.bind(
          this.editForm,
          vm.uid,
          () => this.isSaving
        );
        this.draftFacade.restore(this.editForm);
      });

    this.formFacade.bind();

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


}
