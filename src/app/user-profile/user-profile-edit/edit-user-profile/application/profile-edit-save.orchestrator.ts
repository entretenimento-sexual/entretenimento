import { EnvironmentInjector, Injectable, Optional, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, EMPTY, Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';

@Injectable()
export class ProfileEditSaveOrchestrator {
  constructor(
    private readonly usuarioService: UsuarioService,
    private readonly applicationError: ApplicationErrorService,
    @Optional() private readonly functions?: Functions,
    @Optional() private readonly injector?: EnvironmentInjector
  ) {}

  save$(
    uid: string,
    rawValue: Record<string, unknown>,
    isCouple: boolean,
    photoURL: string | null | undefined
  ): Observable<void> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      this.report(
        new Error('UID ausente para salvar perfil.'),
        'ProfileEditSaveOrchestrator.save',
        'Não foi possível salvar agora.'
      );
      return EMPTY;
    }

    const profilePatch = this.buildPatch(
      rawValue,
      isCouple,
      photoURL
    );

    const hasVisibilityControl = !isCouple && typeof rawValue['showOrientationPublicly'] === 'boolean';
    const orientation = profilePatch.orientation ?? '';
    const writeOrientation$ = hasVisibilityControl
      ? this.saveOrientation$(safeUid, orientation, rawValue['showOrientationPublicly'] === true)
      : null;
    if (writeOrientation$) delete profilePatch.orientation;

    const writeProfile$ = defer(() => this.usuarioService.atualizarUsuario(safeUid, profilePatch));
    return (writeOrientation$ ? writeOrientation$.pipe(switchMap(() => writeProfile$)) : writeProfile$)
      .pipe(
        map(() => void 0),
        catchError((error) => {
          this.report(
            error,
            'ProfileEditSaveOrchestrator.save',
            'Não foi possível salvar agora.'
          );
          return EMPTY;
        })
      );
  }

  private saveOrientation$(uid: string, orientation: string, showOrientationPublicly: boolean): Observable<unknown> {
    return defer(() => {
      if (!this.functions || !this.injector) throw new Error('Serviço de visibilidade indisponível.');
      return runInInjectionContext(this.injector, () =>
        httpsCallable(this.functions!, 'updateProfileOrientation')({ uid, orientation, showOrientationPublicly })
      );
    });
  }

  private buildPatch(
    value: Record<string, unknown>,
    isCouple: boolean,
    photoURL: string | null | undefined
  ): Partial<IUserDados> {
    return {
      estado: String(value['estado'] ?? '').trim(),
      municipio: String(value['municipio'] ?? '').trim(),
      descricao: String(value['descricao'] ?? ''),
      publicDescriptionVisible: value['publicDescriptionVisible'] === true,
      orientation: isCouple
        ? ''
        : String(value['orientation'] ?? '').trim(),
      idade: this.normalizeProfileAge(value['idade']),
      partner1Orientation: isCouple
        ? String(value['partner1Orientation'] ?? '').trim()
        : undefined,
      partner2Orientation: isCouple
        ? String(value['partner2Orientation'] ?? '').trim()
        : undefined,
      photoURL: photoURL ?? null,
    };
  }

  private normalizeProfileAge(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    const age = Number(value);

    return Number.isInteger(age) && age >= 18 && age <= 100
      ? age
      : undefined;
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
        scope: 'ProfileEditSaveOrchestrator',
      },
    });
  }
}
