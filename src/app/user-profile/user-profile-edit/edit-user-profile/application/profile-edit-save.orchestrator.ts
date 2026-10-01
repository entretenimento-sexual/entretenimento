import { Injectable } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';

@Injectable()
export class ProfileEditSaveOrchestrator {
  constructor(
    private readonly usuarioService: UsuarioService,
    private readonly applicationError: ApplicationErrorService
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

    return this.usuarioService
      .atualizarUsuario(safeUid, profilePatch)
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

  private buildPatch(
    value: Record<string, unknown>,
    isCouple: boolean,
    photoURL: string | null | undefined
  ): Partial<IUserDados> {
    return {
      nickname: String(value['nickname'] ?? '').trim(),
      estado: String(value['estado'] ?? '').trim(),
      municipio: String(value['municipio'] ?? '').trim(),
      gender: String(value['gender'] ?? '').trim(),
      descricao: String(value['descricao'] ?? ''),
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
