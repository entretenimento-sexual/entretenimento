// Nickname pre-auth lookup does not expose documents from public_index.
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap, take } from 'rxjs/operators';

import { CacheService } from '../../../general/cache/cache.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

type Mode = 'soft' | 'strict';
type AvailabilityResponse = { status: 'taken' | 'available' };

@Injectable({ providedIn: 'root' })
export class FirestoreValidationService {
  private readonly functions = inject(Functions);

  constructor(
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly injector: Injector
  ) {}

  /**
   * true indica indisponibilidade. false exige confirmação explícita de
   * disponibilidade. A transação autenticada decide a reserva.
   */
  checkIfNicknameExists(
    fullNick: string,
    opts?: { mode?: Mode }
  ): Observable<boolean> {
    const mode: Mode = opts?.mode ?? 'soft';
    const display = NicknameUtils.extrairApelidoPrincipal(fullNick);
    if (!NicknameUtils.isApelidoDeCadastroValido(display)) {
      return throwError(() => new Error('Informe um apelido válido.'));
    }

    const key = NicknameUtils.normalizarApelidoParaIndice(display);
    const cacheKey = `validation:v5:nickname-availability:${key}`;
    const cached$ = mode === 'soft'
      ? this.cache.get<boolean>(cacheKey)
      : of(null);

    return cached$.pipe(
      switchMap((cached) => {
        if (mode === 'soft' && typeof cached === 'boolean') return of(cached);
        const callable = runInInjectionContext(this.injector, () =>
          httpsCallable<{ nickname: string }, AvailabilityResponse>(
            this.functions, 'getRegistrationNicknameAvailability'
          )
        );
        return from(callable({ nickname: display })).pipe(
          map(({ data }) => {
            if (data?.status !== 'taken' && data?.status !== 'available') {
              throw new Error('O servidor não confirmou a disponibilidade do apelido.');
            }
            return data.status === 'taken';
          }),
          tap((taken) => {
            if (mode === 'soft') this.cache.set(cacheKey, taken, 15_000);
          }),
          catchError((error) => {
            // Falha na pré-consulta não permite afirmar "disponível".
            if (mode === 'soft') return throwError(() => error);
            return this.firestoreError.handleFirestoreError(error);
          })
        );
      }),
      take(1)
    );
  }
}
