//src\app\shared\shared\shared.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DateFormatPipe } from './date-format.pipe';
import { CapitalizePipe } from './capitalize.pipe';
import { ModalMensagemComponent } from './components-globais/modal-mensagem/modal-mensagem.component';
import { FormsModule } from '@angular/forms';
import { FotoPreviewModalComponent } from './components-globais/foto-preview-modal/foto-preview-modal.component';

@NgModule({
  declarations: [DateFormatPipe, CapitalizePipe, ModalMensagemComponent, FotoPreviewModalComponent],
  imports: [
    CommonModule,
    FormsModule
  ],
  exports: [DateFormatPipe, CapitalizePipe, ModalMensagemComponent]
})
export class SharedModule { }
