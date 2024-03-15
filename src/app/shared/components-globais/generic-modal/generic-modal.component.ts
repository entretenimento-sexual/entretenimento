//src\app\shared\components-globais\generic-modal\generic-modal.component.ts
import { Component, Input, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-generic-modal',
  templateUrl: './generic-modal.component.html',
  styleUrl: './generic-modal.component.css'
})
export class GenericModalComponent {

  @Input() titulo: string = '';
  @Input() exibir: boolean = false;
  @Input() mensagemErro: string = '';
  @Output() fecharModal = new EventEmitter<void>();

  fechar(): void {
    this.fecharModal.emit();
  }
}
