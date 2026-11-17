import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { RegisterFlowStep } from '../data-access/register-flow.model';

// Apresentação das rotas autorizadas pelo fluxo. A ordem de acesso continua
// sendo decidida pelo RegisterNavigationService e pelos guards.
const STAGES = [
  { step: 'signup', label: 'Conta', action: 'Criar sua conta' },
  { step: 'emailVerification', label: 'E-mail', action: 'Confirmar seu e-mail' },
  { step: 'termsAcceptance', label: 'Termos', action: 'Revisar e aceitar os termos' },
  { step: 'ageVerification', label: '18+', action: 'Confirmar sua maioridade' },
  { step: 'profileCompletion', label: 'Perfil', action: 'Completar seu perfil' },
] as const satisfies readonly { step: RegisterFlowStep; label: string; action: string }[];

type ProgressStep = (typeof STAGES)[number]['step'];

@Component({
  selector: 'app-register-progress',
  standalone: true,
  templateUrl: './register-progress.component.html',
  styleUrl: './register-progress.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterProgressComponent {
  readonly step = input.required<ProgressStep>();
  readonly completed = input(false);

  protected readonly stages = STAGES;
  protected readonly position = computed(() =>
    STAGES.findIndex(stage => stage.step === this.step())
  );
  protected readonly finishedCount = computed(() =>
    this.position() + (this.completed() ? 1 : 0)
  );
  protected readonly nextStage = computed(() => STAGES[this.position() + 1]);
}
