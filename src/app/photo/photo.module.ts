//src\app\photo\photo.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhotoRoutingModule } from './photo-routing.module';
import { UserPhotoGalleryComponent } from './user-photo-gallery/user-photo-gallery.component';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@NgModule({
  declarations: [
    UserPhotoGalleryComponent
  ],

  imports: [
    CommonModule,
    PhotoRoutingModule,
    MatCardModule,
    MatButtonModule,
  ]
})
export class PhotoModule { }
