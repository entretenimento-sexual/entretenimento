// src/app/photo-editor/photo-editor.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { AngularPinturaModule } from '@pqina/angular-pintura';
import { PhotoEditorComponent } from './photo-editor/photo-editor.component';
import { StorageService } from '../core/services/image-handling/storage.service';

@NgModule({
  declarations: [PhotoEditorComponent], // Adicionado aqui
  imports: [
    CommonModule,
    FormsModule,
    AngularPinturaModule,
    MatProgressSpinnerModule
  ],
  providers: [StorageService],
  exports: [PhotoEditorComponent] // Exporte o componente se necessário
})
export class PhotoEditorModule { }
