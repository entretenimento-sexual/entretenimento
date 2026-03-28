// src/app/media/media.routes.ts
// Rotas do domínio Media (fotos/vídeos).
// Ajuste atual:
// - cria uma rota funcional para "/media/photos"
// - mantém as rotas reais parametrizadas para perfil
import { Routes } from '@angular/router';

export const MEDIA_ROUTES: Routes = [
  {
    path: 'photos',
    loadComponent: () =>
      import('./photos/profile-photos/profile-photos.component').then(
        (m) => m.ProfilePhotosComponent
      ),
  },
  {
    path: 'perfil/:id/fotos',
    loadComponent: () =>
      import('./photos/profile-photos/profile-photos.component').then(
        (m) => m.ProfilePhotosComponent
      ),
  },
  {
    path: 'perfil/:id/fotos/upload',
    loadComponent: () =>
      import('./photos/photo-upload/photo-upload.component').then(
        (m) => m.PhotoUploadComponent
      ),
  },

  /* Futuro:
  {
    path: 'videos',
    loadChildren: () =>
      import('./videos/videos.routes').then((m) => m.VIDEOS_ROUTES),
  },
  */
];
