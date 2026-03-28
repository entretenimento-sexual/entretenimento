// src/app/preferences/components/preferences-hub-card/preferences-hub-card.component.ts
// Card de navegação do hub de preferências.
//
// Objetivo:
// - padronizar os blocos de acesso do domínio novo
// - servir como peça reutilizável no hub
// - manter navegação clara e acessível
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-preferences-hub-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './preferences-hub-card.component.html',
  styleUrl: './preferences-hub-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesHubCardComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly route = input.required<string>();
  readonly badge = input<string | null>(null);
}