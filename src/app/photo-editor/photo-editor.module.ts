// src/app/photo-editor/photo-editor.module.ts
import { NgModule } from '@angular/core';
import { PhotoEditorComponent } from './photo-editor/photo-editor.component';
import { StorageService } from '../core/services/image-handling/storage.service';

@NgModule({
  imports: [PhotoEditorComponent],
  providers: [StorageService],
  exports: [PhotoEditorComponent],
})
export class PhotoEditorModule {}
