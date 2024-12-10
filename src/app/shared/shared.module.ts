// src\app\shared\shared\shared.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

// Componentes e pipes
import { DateFormatPipe } from './date-format.pipe';
import { CapitalizePipe } from './capitalize.pipe';
import { ModalMensagemComponent } from './components-globais/modal-mensagem/modal-mensagem.component';
import { TextoDialogComponent } from './components-globais/texto-dialog/texto-dialog.component';
import { ConfirmacaoDialogComponent } from './components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { UploadPhotoComponent } from './components-globais/upload-photo/upload-photo.component';
import { AngularPinturaModule } from '@pqina/angular-pintura';
import { UserCardComponent } from './user-card/user-card.component';
import { RouterModule } from '@angular/router';

@NgModule({
  declarations: [
    DateFormatPipe,
    CapitalizePipe,
    ModalMensagemComponent,
    TextoDialogComponent,
    ConfirmacaoDialogComponent,
    UploadPhotoComponent,
    UserCardComponent,
  ],

  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    AngularPinturaModule,
    RouterModule
  ],
  exports: [
    DateFormatPipe,
    CapitalizePipe,
    ModalMensagemComponent,
    TextoDialogComponent,
    ConfirmacaoDialogComponent,
    UploadPhotoComponent,
    UserCardComponent
  ]
})
export class SharedModule { }
