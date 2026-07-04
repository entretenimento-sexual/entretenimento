// src/app/register-module/data-access/profile-completion.facade.ts
// =============================================================================
// FACADE: PROFILE COMPLETION
// =============================================================================
//
// Responsabilidade desta primeira etapa:
// - carregar dados iniciais do formulário de conclusão de perfil;
// - carregar estados e municípios usados no formulário;
// - manter o componente de UI livre de detalhes de query/IBGE.
//
// Próximas etapas:
// - mover submit do perfil;
// - mover upload de avatar;
// - centralizar feedback de erro/sucesso.
//
// Não faz nesta etapa:
// - escrita em Firestore;
// - upload de imagem;
// - navegação;
// - patch no CurrentUserStoreService.

import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { RegisterFlowVm } from './register-flow.model';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
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

@Injectable({ providedIn: 'root' })
export class ProfileCompletionFacade {
  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
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

  getEstados$(): Observable<IbgeUF[]> {
    return this.ibgeLocationService.getEstados();
  }

  getMunicipios$(estado: string): Observable<IbgeMunicipio[]> {
    return this.ibgeLocationService.getMunicipios(estado);
  }
}
