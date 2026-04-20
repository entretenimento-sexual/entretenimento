// src/app/shared/shared.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { ModalMensagemComponent } from './components-globais/modal-mensagem/modal-mensagem.component';
import { TextoDialogComponent } from './components-globais/texto-dialog/texto-dialog.component';
import { ConfirmacaoDialogComponent } from './components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { UploadPhotoComponent } from './components-globais/upload-photo/upload-photo.component';
import { UniversalSidebarComponent } from './components-globais/universal-sidebar/universal-sidebar.component';

@NgModule({
  declarations: [
    ModalMensagemComponent,
    TextoDialogComponent,
    ConfirmacaoDialogComponent,
    UploadPhotoComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule,
    UniversalSidebarComponent,
  ],
  exports: [
    UniversalSidebarComponent,
    ModalMensagemComponent,
    TextoDialogComponent,
    ConfirmacaoDialogComponent,
    UploadPhotoComponent,
  ]
})
export class SharedModule {}
