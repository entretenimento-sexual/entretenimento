import { computed, Directive, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatTooltip } from '@angular/material/tooltip';
import { EMPTY, map, merge, Subject, switchMap, tap, timer } from 'rxjs';

const FEEDBACK_DURATION_MS = 3_000;

@Directive({
  selector: '[registrationFeedbackTooltip][matTooltip]',
  host: { '(click)': 'showFeedback()' },
})
export class RegistrationFeedbackTooltipDirective {
  readonly automaticMessage = input<string | null>(null, { alias: 'registrationFeedbackTooltip' });
  readonly attempt = input(0, { alias: 'registrationFeedbackAttempt' });

  private readonly tooltip = inject(MatTooltip, { self: true });
  private readonly requested$ = new Subject<void>();

  constructor() {
    const automaticFeedback$ = toObservable(computed(() => {
      const message = this.automaticMessage();
      return { message, attempt: message ? this.attempt() : 0 };
    })).pipe(map(({ message }) => message));

    merge(automaticFeedback$, this.requested$.pipe(map(() => this.tooltip.message))).pipe(
      switchMap(message => {
        if (!message) {
          this.tooltip.hide(0);
          return EMPTY;
        }
        // O botão condicional e a mensagem do Material precisam estar renderizados.
        return timer(0).pipe(
          tap(() => this.tooltip.show(0)),
          switchMap(() => timer(FEEDBACK_DURATION_MS)),
          tap(() => this.tooltip.hide(0)),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe();
  }

  showFeedback(): void {
    this.requested$.next();
  }
}
