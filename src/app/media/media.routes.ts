// src/app/media/media.routes.ts
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
  {
    path: 'perfil/:id/fotos-publicas',
    loadComponent: () =>
      import('./photos/public-profile-photos/public-profile-photos.component').then(
        (m) => m.PublicProfilePhotosComponent
      ),
  },
  {
    path: 'ultimas-fotos',
    loadComponent: () =>
      import('./photos/latest-public-photos/latest-public-photos.component').then(
        (m) => m.LatestPublicPhotosComponent
      ),
  },
  {
    path: 'fotos-top',
    loadComponent: () =>
      import('./photos/top-public-photos/top-public-photos.component').then(
        (m) => m.TopPublicPhotosComponent
      ),
  },
  {
    path: 'fotos-turbinadas',
    loadComponent: () =>
      import('./photos/boosted-public-photos/boosted-public-photos.component').then(
        (m) => m.BoostedPublicPhotosComponent
      ),
  },
];