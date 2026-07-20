// src/app/shared/content-state/content-state.component.ts
// -----------------------------------------------------------------------------
// CONTENT STATE COMPONENT
// -----------------------------------------------------------------------------
// Estado visual reutilizável para carregamento, vazio, erro, offline e conteúdo
// preservado em cache. Mantém acessibilidade e evita telas em branco.
// -----------------------------------------------------------------------------
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type ContentStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'stale';

@Component({
  selector: 'app-content-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './content-state.component.html',
  styleUrls: ['./content-state.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentStateComponent {
  @Input({ required: true }) state: ContentStateKind = 'loading';
  @Input() title = '';
  @Input() message = '';
  @Input() actionLabel = '';
  @Input() compact = false;
  @Input() skeletonRows = 3;

  @Output() action = new EventEmitter<void>();

  get role(): 'alert' | 'status' {
    return this.state === 'error' ? 'alert' : 'status';
  }

  get liveMode(): 'assertive' | 'polite' {
    return this.state === 'error' ? 'assertive' : 'polite';
  }

  get icon(): string {
    switch (this.state) {
      case 'offline':
        return '↯';
      case 'error':
        return '!';
      case 'empty':
        return '○';
      case 'stale':
        return '↻';
      default:
        return '';
    }
  }

  get rows(): number[] {
    const total = Math.min(Math.max(Math.trunc(this.skeletonRows), 1), 6);
    return Array.from({ length: total }, (_, index) => index);
  }

  triggerAction(): void {
    this.action.emit();
  }
}
