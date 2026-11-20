import { Injectable, Optional } from '@angular/core';
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
import { PublicProfileDiscoveryService } from 'src/app/core/services/discovery/public-profile-discovery.service';
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
    private readonly applicationError: ApplicationErrorService,
    @Optional() private readonly publicProfiles?: PublicProfileDiscoveryService
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
            switchMap((estados) => {
              const municipios$ = user.estado ? this.locationService.loadMunicipios$(user.estado) : of([]);
              return this.resolveOrientationVisibility$(uid, user).pipe(
                switchMap((editableUser) => municipios$.pipe(
                  map((municipios) => ({ uid, user: editableUser, estados, municipios }))
                ))
              );
            })
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

  private resolveOrientationVisibility$(uid: string, user: IUserDados): Observable<IUserDados> {
    if (!user.orientation || user.showOrientationPublicly !== undefined || !this.publicProfiles) {
      return of(user);
    }

    // O editor conserva a escolha publicada pelo fluxo anterior quando houver uma.
    return this.publicProfiles.getPublicProfileByUid$(uid).pipe(
      take(1),
      map((profile) => ({
        ...user,
        showOrientationPublicly: profile?.orientation === user.orientation,
      }))
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
