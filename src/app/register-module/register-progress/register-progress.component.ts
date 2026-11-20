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
const STAGE = {
  signup: { step: 'signup', label: 'Conta', action: 'Criar sua conta' },
  email: { step: 'emailVerification', label: 'E-mail', action: 'Confirmar seu e-mail' },
  password: { step: 'passwordSetup', label: 'Senha', action: 'Definir sua senha' },
  terms: { step: 'termsAcceptance', label: 'Termos', action: 'Revisar e aceitar os termos' },
  age: { step: 'ageVerification', label: '18+', action: 'Confirmar sua maioridade' },
  profile: { step: 'profileCompletion', label: 'Perfil', action: 'Completar seu perfil' },
} as const satisfies Record<string, { step: RegisterFlowStep; label: string; action: string }>;

const STAGES = [STAGE.signup, STAGE.email, STAGE.terms, STAGE.age, STAGE.profile] as const;
const EMAIL_LINK_STAGES = [STAGE.email, STAGE.age, STAGE.password, STAGE.terms, STAGE.profile] as const;
const EMAIL_LINK_LATE_AGE_STAGES = [STAGE.email, STAGE.password, STAGE.terms, STAGE.age, STAGE.profile] as const;

type ProgressStep = (typeof STAGES | typeof EMAIL_LINK_STAGES)[number]['step'];

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
  protected readonly stages = computed(() => {
    if (!this.showsPasswordStep()) return STAGES;
    // A rota 18+ autenticada também atende registros antigos sem evidência.
    return this.step() === 'ageVerification' && !this.emailLinkFlow()
      ? EMAIL_LINK_LATE_AGE_STAGES : EMAIL_LINK_STAGES;
  });
  protected readonly position = computed(() =>
    this.stages().findIndex(stage => stage.step === this.step())
  );
  protected readonly finishedCount = computed(() =>
    this.position() + (this.completed() ? 1 : 0)
  );
  protected readonly upcomingAction = computed(() =>
    this.nextAction() ?? this.stages()[this.position() + 1]?.action ?? null
  );
}
