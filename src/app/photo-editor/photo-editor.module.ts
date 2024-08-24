// src/app/photo-editor/photo-editor.module.ts
import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PhotoEditorComponent } from './photo-editor/photo-editor.component';
import { SharedModule } from '../shared/shared.module';


@NgModule({
  declarations: [
    PhotoEditorComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule, // Adicione esta linha
  ],
  exports: [PhotoEditorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class PhotoEditorModule { }
