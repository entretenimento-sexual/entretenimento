//src\app\photo\photo.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhotoRoutingModule } from './photo-routing.module';
import { UserPhotoGalleryComponent } from './user-photo-gallery/user-photo-gallery.component';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { BrushToolComponent } from './tools-edit-photo/brush-tool/brush-tool.component';
import { PhotoEditorComponent } from './photo-editor/photo-editor.component';

@NgModule({
  declarations: [
    UserPhotoGalleryComponent,
    PhotoEditorComponent, 
    BrushToolComponent
  ],

  imports: [
    CommonModule,
    PhotoRoutingModule,
    MatCardModule,
    MatButtonModule,
  ]
})
export class PhotoModule { }
