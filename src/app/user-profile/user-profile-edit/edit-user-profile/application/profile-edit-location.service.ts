import { Injectable } from '@angular/core';
import { EMPTY, Observable, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';

export interface ProfileEditEstado {
  id: number;
  sigla: string;
  nome: string;
}

export interface ProfileEditMunicipio {
  id: number;
  nome: string;
}

@Injectable()
export class ProfileEditLocationService {
  constructor(
    private readonly applicationError: ApplicationErrorService
  ) {}

  loadEstados$(): Observable<ProfileEditEstado[]> {
    return from(
      fetch(
        'https://servicodados.ibge.gov.br/api/v1/localidades/estados'
      ).then((response) => response.json())
    ).pipe(
      map((estados: ProfileEditEstado[]) =>
        (estados ?? []).sort((first, second) =>
          first.nome.localeCompare(second.nome)
        )
      ),
      catchError((error) => {
        this.report(
          error,
          'ProfileEditLocationService.loadEstados',
          'Erro ao carregar estados.'
        );
        return EMPTY;
      })
    );
  }

  loadMunicipios$(
    estadoSigla: string
  ): Observable<ProfileEditMunicipio[]> {
    const sigla = String(estadoSigla ?? '').trim();
    if (!sigla) return EMPTY;

    return from(
      fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(sigla)}/municipios`
      ).then((response) => response.json())
    ).pipe(
      map((municipios: ProfileEditMunicipio[]) =>
        (municipios ?? []).sort((first, second) =>
          first.nome.localeCompare(second.nome)
        )
      ),
      catchError((error) => {
        this.report(
          error,
          'ProfileEditLocationService.loadMunicipios',
          'Erro ao carregar municípios.'
        );
        return EMPTY;
      })
    );
  }

  private report(
    error: unknown,
    operation: string,
    fallbackMessage: string
  ): void {
    this.applicationError.report(error, {
      feature: 'profile-edit',
      operation,
      fallbackMessage,
      metadata: {
        scope: 'ProfileEditLocationService',
      },
    });
  }
}
