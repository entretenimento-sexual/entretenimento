import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

@Component({
  selector: 'app-media-action-menu',
  standalone: true,
  imports: [SharedMaterialModule],
  templateUrl: './media-action-menu.component.html',
  styleUrls: ['./media-action-menu.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaActionMenuComponent {
  @Input() disabled = false;

  @Input() editLabel = 'Editar';
  @Input() secondaryLabel = '';
  @Input() secondaryIcon = 'tune';
  @Input() showSecondaryAction = false;

  @Input() featureLabel = '';
  @Input() featureCurrentLabel = '';
  @Input() featureIcon = 'star';
  @Input() showFeatureAction = false;
  @Input() featureActive = false;

  @Input() deleteLabel = 'Excluir';

  @Output() edit = new EventEmitter<void>();
  @Output() secondaryAction = new EventEmitter<void>();
  @Output() featureAction = new EventEmitter<void>();
  @Output() deleteRequested = new EventEmitter<void>();

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }
}
