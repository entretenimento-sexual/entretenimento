// src/app/photo-editor/photo-editor.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AngularPinturaModule } from '@pqina/angular-pintura';
import { StorageService } from '../core/services/image-handling/storage.service';

@NgModule({
  declarations: [],

  imports: [
    CommonModule,
    FormsModule,
    AngularPinturaModule
  ],

  providers: [StorageService],
  exports: []
})
export class PhotoEditorModule { }
