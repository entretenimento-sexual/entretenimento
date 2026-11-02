// Nickname pre-auth lookup does not expose documents from public_index.
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap, tap, take } from 'rxjs/operators';

import { CacheService } from '../../../general/cache/cache.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

type Mode = 'soft' | 'strict';
type AvailabilityResponse = { status: 'taken' | 'unconfirmed' };

@Injectable({ providedIn: 'root' })
export class FirestoreValidationService {
  private readonly functions = inject(Functions);

  constructor(
    private readonly cache: CacheService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly injector: Injector
  ) {}

  /**
   * Mantém nomenclatura e Observable<boolean> existentes. true significa
   * nickname PUBLICADO em uso. false é somente provisório: inclui nomes
   * livres, reservados e ocultos. A transação autenticada decide a reserva.
   */
  checkIfNicknameExists(
    fullNick: string,
    opts?: { mode?: Mode }
  ): Observable<boolean> {
    const mode: Mode = opts?.mode ?? 'soft';
    const display = NicknameUtils.normalizarApelido(fullNick);
    if (!NicknameUtils.isApelidoValido(display) ||
      !NicknameUtils.isApelidoIndiceValido(display)) {
      return of(false);
    }

    const key = NicknameUtils.normalizarApelidoParaIndice(display);
    const cacheKey = `validation:v3:published-nickname:${key}`;
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
            if (data?.status !== 'taken' && data?.status !== 'unconfirmed') {
              throw new Error('Resposta de disponibilidade inválida.');
            }
            return data.status === 'taken';
          }),
          tap((taken) => {
            if (mode === 'soft') this.cache.set(cacheKey, taken, 15_000);
          }),
          catchError((error) => {
            // Falha na pré-consulta não permite afirmar "disponível".
            if (mode === 'soft') return of(false);
            return this.firestoreError.handleFirestoreError(error);
          })
        );
      }),
      take(1)
    );
  }
}
