import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { isEmailLinkPreviewUid } from '@core/services/autentication/register/email-link-registration.service';
import type { RegisterFlowStep } from '../data-access/register-flow.model';

// Apresentação das rotas autorizadas pelo fluxo. A ordem de acesso continua
// sendo decidida pelo RegisterNavigationService e pelos guards.
const STAGES = [
  { step: 'signup', label: 'Conta', action: 'Criar sua conta' },
  { step: 'emailVerification', label: 'E-mail', action: 'Confirmar seu e-mail' },
  { step: 'passwordSetup', label: 'Senha', action: 'Definir sua senha' },
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
  readonly signupLabel = input('Conta');
  readonly completed = input(false);
  readonly nextAction = input<string | null>(null);
  readonly compact = input(false);
  readonly emailLinkFlow = input(false);
  readonly ownerUid = input<string | null | undefined>(null);

  protected readonly showsPasswordStep = computed(() => {
    const uid = this.ownerUid();
    return this.emailLinkFlow() || this.step() === 'passwordSetup' || (!!uid && isEmailLinkPreviewUid(uid));
  });
  protected readonly stages = computed(() => this.showsPasswordStep()
    ? STAGES : STAGES.filter(stage => stage.step !== 'passwordSetup')
  );
  protected readonly position = computed(() =>
    this.stages().findIndex(stage => stage.step === this.step())
  );
  protected readonly finishedCount = computed(() =>
    this.position() + (this.completed() ? 1 : 0)
  );
  protected readonly upcomingAction = computed(() =>
    this.nextAction() ??
    (this.step() === 'termsAcceptance' && this.showsPasswordStep()
      ? 'Validar o registro de maioridade' : this.stages()[this.position() + 1]?.action) ?? null
  );
}
