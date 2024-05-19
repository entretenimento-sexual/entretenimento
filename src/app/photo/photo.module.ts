//src\app\photo\photo.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhotoRoutingModule } from './photo-routing.module';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';

import { UserPhotoGalleryComponent } from './user-photo-gallery/user-photo-gallery.component';
import { BrushToolComponent } from './tools-edit-photo/brush-tool/brush-tool.component';
import { PhotoEditorComponent } from './photo-editor/photo-editor.component';
import { BrightnessContrastToolComponent } from './tools-edit-photo/brightness-contrast-tool/brightness-contrast-tool.component';
import { FaceBlurToolComponent } from './tools-edit-photo/face-blur-tool/face-blur-tool.component';
import { CropToolComponent } from './tools-edit-photo/crop-tool/crop-tool.component';

@NgModule({
  declarations: [
    UserPhotoGalleryComponent,
    PhotoEditorComponent,
    BrushToolComponent,
    BrightnessContrastToolComponent,
    FaceBlurToolComponent,
    CropToolComponent
  ],
  imports: [
    CommonModule,
    PhotoRoutingModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule
  ]
})
export class PhotoModule { }

