//src\app\shared\shared\shared.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Importação de componentes e pipes
import { DateFormatPipe } from './date-format.pipe';
import { CapitalizePipe } from './capitalize.pipe';
import { ModalMensagemComponent } from './components-globais/modal-mensagem/modal-mensagem.component';
import { TextoDialogComponent } from './components-globais/texto-dialog/texto-dialog.component';
import { ConfirmacaoDialogComponent } from './components-globais/confirmacao-dialog/confirmacao-dialog.component';

// Importação de módulos do Angular Material
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

@NgModule({
  declarations: [
    DateFormatPipe,
    CapitalizePipe,
    ModalMensagemComponent,
    TextoDialogComponent,
    ConfirmacaoDialogComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
  ],
  exports: [
    DateFormatPipe,
    CapitalizePipe,
    ModalMensagemComponent,
    TextoDialogComponent,
    ConfirmacaoDialogComponent
  ]
})
export class SharedModule { }



