import { Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Observable, of, throwError } from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  ProfileEditEstado,
  ProfileEditLocationService,
  ProfileEditMunicipio,
} from './profile-edit-location.service';

export interface ProfileEditBootstrapVm {
  uid: string;
  user: IUserDados;
  estados: ProfileEditEstado[];
  municipios: ProfileEditMunicipio[];
}

@Injectable()
export class ProfileEditBootstrapFacade {
  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly locationService: ProfileEditLocationService,
    private readonly notify: ErrorNotificationService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  load$(): Observable<ProfileEditBootstrapVm> {
    const uid = this.resolveUid();

    if (!uid) {
      this.notify.showError(
        'Não foi possível identificar o usuário para edição.'
      );
      this.router.navigate(['/perfil']).catch(() => undefined);
      return EMPTY;
    }

    return this.firestoreUserQuery
      .getUser(uid)
      .pipe(
        take(1),
        switchMap((user) => {
          if (!user) {
            return throwError(
              () => new Error('Usuário não encontrado.')
            );
          }

          return this.locationService.loadEstados$().pipe(
            switchMap((estados) =>
              (user.estado
                ? this.locationService.loadMunicipios$(user.estado)
                : of([])
              ).pipe(
                map((municipios) => ({
                  uid,
                  user,
                  estados,
                  municipios,
                }))
              )
            )
          );
        }),
        catchError((error) => {
          this.applicationError.report(error, {
            feature: 'profile-edit',
            operation: 'ProfileEditBootstrapFacade.load',
            fallbackMessage:
              'Falha ao carregar seus dados para edição.',
            metadata: {
              scope: 'ProfileEditBootstrapFacade',
              hasUid: true,
            },
          });

          return EMPTY;
        })
      );
  }

  private resolveUid(): string {
    return String(
      this.route.snapshot.paramMap.get('id') ??
        this.route.snapshot.paramMap.get('uid') ??
        ''
    ).trim();
  }
}
