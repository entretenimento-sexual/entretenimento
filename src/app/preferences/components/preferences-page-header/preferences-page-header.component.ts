// src/app/preferences/components/preferences-page-header/preferences-page-header.component.ts
// Cabeçalho reutilizável do domínio de preferências.
// Não cria shell novo. Só compõe o topo interno das páginas do domínio.
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-preferences-page-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preferences-page-header.component.html',
  styleUrl: './preferences-page-header.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesPageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}