//src\app\shared\shared\shared.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DateFormatPipe } from './date-format.pipe';
import { CapitalizePipe } from './capitalize.pipe';
import { ModalMensagemComponent } from './components-globais/modal-mensagem/modal-mensagem.component';
import { FormsModule } from '@angular/forms';
import { FotoPreviewModalComponent } from './components-globais/foto-preview-modal/foto-preview-modal.component';
import { TextoDialogComponent } from './components-globais/texto-dialog/texto-dialog.component';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ConfirmacaoDialogComponent } from './components-globais/confirmacao-dialog/confirmacao-dialog.component';


@NgModule({
  declarations: [DateFormatPipe, CapitalizePipe, ModalMensagemComponent,
    FotoPreviewModalComponent, TextoDialogComponent, ConfirmacaoDialogComponent],

  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,

  ],
  exports: [DateFormatPipe, CapitalizePipe, ModalMensagemComponent]
})
export class SharedModule { }
