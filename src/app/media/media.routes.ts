// src/app/media/media.routes.ts
import { importProvidersFrom } from '@angular/core';
import { Routes } from '@angular/router';
import { EffectsModule } from '@ngrx/effects';
import { StoreModule } from '@ngrx/store';

import { ProfileVideoLibraryEffects } from './videos/state/profile-video-library.effects';
import { ProfileVideoLibraryFacade } from './videos/state/profile-video-library.facade';
import { profileVideoLibraryFeature } from './videos/state/profile-video-library.reducer';

function provideProfileVideoLibrary() {
  return [
    importProvidersFrom(
      StoreModule.forFeature(
        profileVideoLibraryFeature.name,
        profileVideoLibraryFeature.reducer
      ),
      EffectsModule.forFeature(ProfileVideoLibraryEffects)
    ),
    ProfileVideoLibraryFacade,
  ];
}

export const MEDIA_ROUTES: Routes = [
  {
    path: 'photos',
    loadComponent: () =>
      import('./photos/profile-photos/profile-photos.component').then(
        (m) => m.ProfilePhotosComponent
      ),
  },
  {
    path: 'videos',
    providers: provideProfileVideoLibrary(),
    loadComponent: () =>
      import('./videos/profile-videos/profile-videos.component').then(
        (m) => m.ProfileVideosComponent
      ),
  },
  {
    path: 'video/:ownerUid/:videoId',
    loadComponent: () =>
      import('./videos/public-profile-videos/public-profile-videos.component').then(
        (m) => m.PublicProfileVideosComponent
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
    path: 'perfil/:id/videos',
    providers: provideProfileVideoLibrary(),
    loadComponent: () =>
      import('./videos/profile-videos/profile-videos.component').then(
        (m) => m.ProfileVideosComponent
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
    path: 'perfil/:id/videos-publicos',
    loadComponent: () =>
      import('./videos/public-profile-videos/public-profile-videos.component').then(
        (m) => m.PublicProfileVideosComponent
      ),
  },
  {
    path: 'denunciar/photo/:ownerUid/:photoId',
    loadComponent: () =>
      import('./videos/video-report-page/video-report-page.component').then(
        (m) => m.VideoReportPageComponent
      ),
  },
  {
    path: 'denunciar/video/:ownerUid/:videoId/:targetType/:targetId',
    loadComponent: () =>
      import('./videos/video-report-page/video-report-page.component').then(
        (m) => m.VideoReportPageComponent
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
