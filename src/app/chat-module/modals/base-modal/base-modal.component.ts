//src\app\chat-module\modals\base-modal\base-modal.component.ts
import { Component, Output, EventEmitter, input } from '@angular/core';

@Component({
  selector: 'app-base-modal',
  templateUrl: './base-modal.component.html',
  styleUrls: ['./base-modal.component.css'],
  standalone: true,
  imports: [],
})

export class BaseModalComponent {
  readonly title = input<string>('');
  @Output() closeModal = new EventEmitter<void>();

  onClose() {
    this.closeModal.emit();
  }
}
