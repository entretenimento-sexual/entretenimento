//src\app\store\effects\effects.interactions\helpers\effects-helpers.ts
import { OperatorFunction, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export const toFailure =
  <T>(failureAction: (p: { error: string }) => any): OperatorFunction<T, T | ReturnType<typeof failureAction>> =>
    (source$) =>
      source$.pipe(
        catchError((err) => of(failureAction({ error: String(err?.message ?? err) })))
      );
