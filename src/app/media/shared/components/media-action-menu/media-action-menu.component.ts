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
  @Input() canSetCover = false;
  @Input() isCover = false;

  @Output() edit = new EventEmitter<void>();
  @Output() changeDate = new EventEmitter<void>();
  @Output() setCover = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }
}
