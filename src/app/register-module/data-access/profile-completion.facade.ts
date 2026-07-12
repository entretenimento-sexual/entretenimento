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

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import {
  IBGELocationService,
  IbgeMunicipio,
  IbgeUF,
} from 'src/app/core/services/general/api/ibge-location.service';

export interface ProfileCompletionInitialData {
  email: string;
  nickname: string;
  gender: string;
  orientation: string;
  estado: string;
  municipio: string;
}

export interface ProfileCompletionSubmitInput {
  uid: string;
  vm: RegisterFlowVm;
  nickname: string;
  gender: string;
  orientation: string;
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
    private readonly profileAvatarWrite: ProfileAvatarWriteService,
    private readonly profileCompletionWrite: ProfileCompletionWriteService,
    private readonly storageService: StorageService,
    private readonly ibgeLocationService: IBGELocationService
  ) {}

  loadUserForFormByUid$(
    uid: string,
    vm: RegisterFlowVm
  ): Observable<ProfileCompletionInitialData | null> {
    const safeUid = (uid ?? '').trim();

    return this.firestoreUserQuery.getUser(safeUid).pipe(
      map((doc) => {
        if (!doc) {
          return null;
        }

        return {
          email: doc.email ?? vm.email ?? '',
          nickname: doc.nickname ?? '',
          gender: doc.gender ?? '',
          orientation: doc.orientation ?? '',
          estado: doc.estado ?? '',
          municipio: doc.municipio ?? '',
        };
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
          orientation: input.orientation || existingUserData.orientation || '',
          estado: input.estado || existingUserData.estado || '',
          municipio: input.municipio || existingUserData.municipio || '',
        });
      })
    );
  }

  uploadProfileAvatarAfterSave$(
    input: ProfileCompletionAvatarUploadInput
  ): Observable<ProfileCompletionAvatarUploadResult> {
    const uid = (input.uid ?? '').trim();
    const file = input.file ?? null;

    if (!uid || !file) {
      return of({ status: 'skipped' });
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
