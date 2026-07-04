// src/app/register-module/data-access/profile-completion.facade.ts
// =============================================================================
// FACADE: PROFILE COMPLETION
// =============================================================================
//
// Responsabilidade:
// - carregar dados iniciais do formulário de conclusão de perfil;
// - carregar estados e municípios usados no formulário;
// - montar o payload canônico de conclusão de perfil;
// - salvar os dados principais do perfil no Firestore.
//
// Ainda não faz:
// - upload de avatar;
// - navegação;
// - feedback visual direto;
// - patch no CurrentUserStoreService.
//
// Regra:
// - o componente continua controlando estado visual;
// - esta facade concentra leitura e persistência principal do perfil;
// - upload de avatar será extraído em etapa separada.
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { RegisterFlowVm } from './register-flow.model';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { FirestoreUserWriteService } from 'src/app/core/services/data-handling/firestore-user-write.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
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

export type ProfileCompletionPayload = Partial<IUserRegistrationData> & Partial<IUserDados>;

export interface ProfileCompletionSubmitInput {
  uid: string;
  vm: RegisterFlowVm;
  gender: string;
  orientation: string;
  estado: string;
  municipio: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileCompletionFacade {
  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly firestoreUserWrite: FirestoreUserWriteService,
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

        const completionPayload: ProfileCompletionPayload = {
          uid,
          nickname: existingUserData.nickname || '',
          gender: input.gender || existingUserData.gender || '',
          orientation: input.orientation || existingUserData.orientation || '',
          estado: input.estado || existingUserData.estado || '',
          municipio: input.municipio || existingUserData.municipio || '',
          profileCompleted: true,
        };

        return this.firestoreUserWrite.saveInitialUserData$(uid, completionPayload);
      })
    );
  }

  getEstados$(): Observable<IbgeUF[]> {
    return this.ibgeLocationService.getEstados();
  }

  getMunicipios$(estado: string): Observable<IbgeMunicipio[]> {
    return this.ibgeLocationService.getMunicipios(estado);
  }
}
