// src\app\photo\photo-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { PhotoUploaderComponent } from './photo-uploader/photo-uploader.component';
import { PhotoViewerComponent } from './photo-viewer/photo-viewer.component';
// Importe outros componentes conforme necessário

const routes: Routes = [
  { path: 'upload', component: PhotoUploaderComponent },
  { path: 'view', component: PhotoViewerComponent },
  // Defina outras rotas conforme necessário
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PhotoRoutingModule { }
