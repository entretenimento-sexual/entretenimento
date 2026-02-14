// src\app\media\media.routes.ts
// Rotas do domínio Media (fotos/vídeos). Mantém a expansão organizada.
// Aqui ainda é MVP: só a rota de fotos do perfil.
import { Routes } from '@angular/router';

export const MEDIA_ROUTES: Routes = [
  {
    path: 'perfil/:id/fotos',
    loadComponent: () =>
      import('./photos/profile-photos/profile-photos.component').then((m) => m.ProfilePhotosComponent),
  },
  {
    path: 'perfil/:id/fotos/upload',
    loadComponent: () =>
      import('./photos/photo-upload/photo-upload.component').then((m) => m.PhotoUploadComponent),
  },

/*   {
    path: 'videos',
    loadChildren: () =>
      import('./videos/videos.routes')
        .then(m => m.VIDEOS_ROUTES),
  }, */

  // Futuro:
  // { path: 'perfil/:id/videos', loadComponent: ... }
];
