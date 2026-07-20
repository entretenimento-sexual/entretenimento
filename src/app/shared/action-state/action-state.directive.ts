// src/app/shared/action-state/action-state.directive.ts
// -----------------------------------------------------------------------------
// ACTION STATE DIRECTIVE
// -----------------------------------------------------------------------------
// Padroniza o estado de botões e controles acionáveis durante operações
// assíncronas. A lógica de domínio continua responsável por iniciar/finalizar a
// operação; a diretiva somente garante bloqueio, semântica e feedback de estado.
// -----------------------------------------------------------------------------
import { Directive, HostBinding, Input } from '@angular/core';

@Directive({
  selector: 'button[appActionState], input[appActionState]',
  standalone: true,
})
export class ActionStateDirective {
  @Input('appActionState') pending = false;
  @Input() actionDisabled = false;

  @HostBinding('disabled')
  get disabled(): boolean {
    return this.pending || this.actionDisabled;
  }

  @HostBinding('attr.aria-busy')
  get ariaBusy(): 'true' | null {
    return this.pending ? 'true' : null;
  }

  @HostBinding('attr.aria-disabled')
  get ariaDisabled(): 'true' | null {
    return this.disabled ? 'true' : null;
  }

  @HostBinding('class.app-action-state--pending')
  get pendingClass(): boolean {
    return this.pending;
  }
}
