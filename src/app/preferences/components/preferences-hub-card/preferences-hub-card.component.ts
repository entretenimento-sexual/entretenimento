// src/app/preferences/components/preferences-hub-card/preferences-hub-card.component.ts
// Card de navegação do hub de preferências.
//
// Objetivo:
// - padronizar os blocos de acesso do domínio novo
// - servir como peça reutilizável no hub
// - manter navegação clara e acessível
// Visua clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-preferences-hub-card',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './preferences-hub-card.component.html',
  styleUrl: './preferences-hub-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesHubCardComponent {
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  readonly route = input.required<string>();
}