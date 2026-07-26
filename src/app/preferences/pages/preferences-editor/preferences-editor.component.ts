// src/app/preferences/pages/preferences-editor/preferences-editor.component.ts
// -----------------------------------------------------------------------------
// EDITOR DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// Fluxo visual:
// - plano atual em uma única faixa contextual;
// - preferências permanentes em grupos progressivos;
// - disponibilidade temporária em área separada e recolhível.
//
// Segurança de navegação:
// - o editor é sempre da conta autenticada;
// - não consome UID vindo da URL;
// - links legados com UID são redirecionados pela configuração de rotas.
//
// Supressões visuais desta revisão:
// - resumo duplicado das preferências;
// - painel de recursos bloqueados;
// - resumo duplicado da intenção;
// - navegação técnica interna no editor.
// Os componentes continuam existentes para outras páginas que ainda os utilizam.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { PreferencesEditorFacade } from '../../application/preferences-editor.facade';
import { IntentState } from '../../models/intent-state.model';
import { PreferenceProfile } from '../../models/preference-profile.model';
import {
  PreferencesCapabilitySnapshot,
  PreferencesPlanRole,
} from '../../services/preferences-capability.service';
import { PreferencesUiService } from '../../state/preferences-ui.service';

import { IntentStateFormComponent } from '../../components/intent-state-form/intent-state-form.component';
import { PreferenceProfileFormComponent } from '../../components/preference-profile-form/preference-profile-form.component';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';

@Component({
  selector: 'app-preferences-editor',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PreferenceProfileFormComponent,
    IntentStateFormComponent,
    PreferencesPageHeaderComponent,
  ],
  templateUrl: './preferences-editor.component.html',
  styleUrl: './preferences-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesEditorComponent {
  private readonly editorFacade = inject(PreferencesEditorFacade);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly preferencesUi = inject(PreferencesUiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSavingProfile = signal(false);
  readonly isSavingIntent = signal(false);

  // Fonte canônica: sessão autenticada. O componente não interpreta UID de rota.
  readonly state$ = this.editorFacade.currentEditorState$;

  constructor() {
    this.preferencesUi.setActiveView('editor');
  }

  onSaveProfile(uid: string, profile: PreferenceProfile): void {
    if (!uid || this.isSavingProfile()) return;

    this.isSavingProfile.set(true);

    this.editorFacade
      .saveProfileOnly$(uid, profile)
      .pipe(
        finalize(() => this.isSavingProfile.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.notifier.showSuccess('Preferências salvas com sucesso.');
        },
        error: () => {
          // Feedback de erro já tratado pela façade.
        },
      });
  }

  onSaveIntent(uid: string, intent: IntentState): void {
    if (!uid || this.isSavingIntent()) return;

    this.isSavingIntent.set(true);

    this.editorFacade
      .saveIntentOnly$(uid, intent)
      .pipe(
        finalize(() => this.isSavingIntent.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.notifier.showSuccess('Disponibilidade atualizada.');
        },
        error: () => {
          // Feedback de erro já tratado pela façade.
        },
      });
  }

  planMessage(capabilities: PreferencesCapabilitySnapshot): string {
    switch (capabilities.currentPlan) {
      case 'basic':
        return 'Preferências detalhadas e contexto de disponibilidade liberados.';
      case 'premium':
        return 'Descoberta avançada, modo discreto e compatibilidade liberados.';
      case 'vip':
      case 'admin':
        return 'Todos os recursos de preferências e visibilidade estão liberados.';
      case 'free':
      default:
        return 'Preferências essenciais disponíveis sem assinatura.';
    }
  }

  nextPlan(capabilities: PreferencesCapabilitySnapshot): PreferencesPlanRole | null {
    switch (capabilities.currentPlan) {
      case 'free':
      case null:
        return 'basic';
      case 'basic':
        return 'premium';
      case 'premium':
        return 'vip';
      case 'vip':
      case 'admin':
      default:
        return null;
    }
  }

  intentSummary(intent: IntentState): string {
    const labels: Readonly<Record<IntentState['mode'], string>> = {
      inactive: 'Não disponível agora',
      chat: 'Disponível para conversar',
      meet_today: 'Disponível para encontro hoje',
      casual: 'Busca casual',
      dating: 'Busca namoro',
      serious: 'Busca relacionamento sério',
      fetish: 'Busca interesses específicos',
      travel: 'Em contexto de viagem',
    };

    return labels[intent.mode] ?? 'Não disponível agora';
  }
}
