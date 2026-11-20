// src/app/register-module/data-access/profile-completion.facade.ts
// =============================================================================
// FACADE: PROFILE COMPLETION
// =============================================================================
//
// Responsabilidade:
// - carregar dados iniciais do formulário de conclusão de perfil;
// - carregar estados e municípios usados no formulário;
// - delegar a conclusão atômica do perfil e reserva de nickname;
// - fazer upload do avatar e sincronizar a URL no perfil.
//
// Ainda não faz:
// - navegação;
// - feedback visual direto;
// - patch no CurrentUserStoreService.
//
// Regra:
// - o componente continua controlando estado visual;
// - a persistência principal pertence ao ProfileCompletionWriteService;
// - falha de avatar não deve invalidar a conclusão do perfil.

import { Injectable } from '@angular/core';

import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { RegisterFlowVm } from './register-flow.model';
import { ProfileAvatarWriteService } from './profile-avatar-write.service';
import { ProfileCompletionWriteService } from './profile-completion-write.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  EmailLinkRegistrationService,
  isEmailLinkPreviewUid,
} from 'src/app/core/services/autentication/register/email-link-registration.service';
import { FirestoreReadService } from 'src/app/core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { validateImageMediaFile } from 'src/app/core/services/media/media-format.policy';
import {
  IBGELocationService,
  IbgeMunicipio,
  IbgeUF,
} from 'src/app/core/services/general/api/ibge-location.service';

export interface ProfileCompletionInitialData {
  email: string;
  nickname: string;
  savedNicknameSuggestion?: string;
  gender: string;
  orientation: string;
  showOrientationPublicly?: boolean;
  estado: string;
  municipio: string;
}

export interface ProfileCompletionSubmitInput {
  uid: string;
  vm: RegisterFlowVm;
  nickname: string;
  gender: string;
  orientation: string;
  showOrientationPublicly?: boolean;
  estado: string;
  municipio: string;
}

export type ProfileCompletionAvatarUploadStatus =
  | 'skipped'
  | 'uploaded'
  | 'upload_failed'
  | 'avatar_patch_failed';

export interface ProfileCompletionAvatarUploadInput {
  uid: string;
  file: File | null;
  onProgress?: (progress: number) => void;
}

export interface ProfileCompletionAvatarUploadResult {
  status: ProfileCompletionAvatarUploadStatus;
  photoURL?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileCompletionFacade {
  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly firestoreRead: FirestoreReadService,
    private readonly profileAvatarWrite: ProfileAvatarWriteService,
    private readonly profileCompletionWrite: ProfileCompletionWriteService,
    private readonly storageService: StorageService,
    private readonly ibgeLocationService: IBGELocationService,
    private readonly emailLink: EmailLinkRegistrationService
  ) {}

  loadUserForFormByUid$(
    uid: string,
    vm: RegisterFlowVm
  ): Observable<ProfileCompletionInitialData | null> {
    const safeUid = (uid ?? '').trim();

    return this.firestoreUserQuery.getUser(safeUid).pipe(
      switchMap((doc) => {
        if (!doc) {
          return of(null);
        }

        const initialData = {
          email: doc.email ?? vm.email ?? '',
          nickname: doc.nickname ?? '',
          gender: doc.gender ?? '',
          orientation: doc.orientation ?? '',
          showOrientationPublicly: doc.showOrientationPublicly === true,
          estado: doc.estado ?? '',
          municipio: doc.municipio ?? '',
        };
        if (initialData.nickname.trim() || !isEmailLinkPreviewUid(safeUid)) return of(initialData);

        // Uma interrupção após criar a senha pode anteceder a reserva do apelido.
        // O recibo privado fornece o valor original enquanto o campo segue editável.
        return this.emailLink.preparedNickname$(safeUid).pipe(
          map(nickname => nickname ? { ...initialData, savedNicknameSuggestion: nickname } : initialData),
          catchError(() => of(initialData))
        );
      })
    );
  }

  saveProfileCompletion$(input: ProfileCompletionSubmitInput): Observable<void> {
    const uid = (input.uid ?? '').trim();

    if (!uid) {
      return throwError(() => new Error('[ProfileCompletionFacade] UID inválido.'));
    }

    return this.loadUserForFormByUid$(uid, input.vm).pipe(
      take(1),
      switchMap((existingUserData) => {
        if (!existingUserData) {
          return throwError(
            () => new Error('[ProfileCompletionFacade] Dados do usuário não encontrados.')
          );
        }

        return this.profileCompletionWrite.complete$({
          uid,
          nickname: input.nickname || existingUserData.nickname || '',
          gender: input.gender || existingUserData.gender || '',
          orientation: input.orientation ?? existingUserData.orientation ?? '',
          showOrientationPublicly: input.showOrientationPublicly === true,
          estado: input.estado || existingUserData.estado || '',
          municipio: input.municipio || existingUserData.municipio || '',
        });
      })
    );
  }

  confirmProfileCompletion$(uid: string): Observable<boolean> {
    return this.firestoreRead.getDocument<Pick<IUserDados, 'uid' | 'profileCompleted'>>('users', uid, {
      source: 'server',
      requireCommitted: true,
      silent: true,
      context: 'registration-profile-completion',
    }).pipe(map((user) => user?.uid === uid && user.profileCompleted === true));
  }

  uploadProfileAvatarAfterSave$(
    input: ProfileCompletionAvatarUploadInput
  ): Observable<ProfileCompletionAvatarUploadResult> {
    const uid = (input.uid ?? '').trim();
    const file = input.file ?? null;

    if (!uid || !file) {
      return of({ status: 'skipped' });
    }

    const validation = validateImageMediaFile(file, 'avatar');
    if (!validation.valid) {
      return of({ status: 'upload_failed' });
    }

    return this.storageService
      .uploadProfileAvatar(file, uid, (progress) => {
        input.onProgress?.(progress);
      })
      .pipe(
        switchMap((photoURL) => {
          if (!photoURL) {
            return of({ status: 'upload_failed' } as ProfileCompletionAvatarUploadResult);
          }

          return this.profileAvatarWrite.patchAvatar$(uid, photoURL).pipe(
            map(() => ({
              status: 'uploaded',
              photoURL,
            } as ProfileCompletionAvatarUploadResult)),
            catchError(() =>
              of({
                status: 'avatar_patch_failed',
                photoURL,
              } as ProfileCompletionAvatarUploadResult)
            )
          );
        }),
        catchError(() =>
          of({
            status: 'upload_failed',
          } as ProfileCompletionAvatarUploadResult)
        )
      );
  }

  getEstados$(): Observable<IbgeUF[]> {
    return this.ibgeLocationService.getEstados();
  }

  getMunicipios$(estado: string): Observable<IbgeMunicipio[]> {
    return this.ibgeLocationService.getMunicipios(estado);
  }
}
