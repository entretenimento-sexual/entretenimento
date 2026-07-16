// src/app/media/media.routes.ts
import { Routes } from '@angular/router';

import {
  mediaOwnerCanMatch,
  mediaUploadEligibilityCanMatch,
} from './guards/media-route.guard';

export const MEDIA_ROUTES: Routes = [
  {
    path: 'photos',
    canMatch: [mediaOwnerCanMatch],
    data: {
      mediaOwnerRedirectKind: 'fotos',
    },
    loadComponent: () =>
      import('./photos/profile-photos/profile-photos.component').then(
        (m) => m.ProfilePhotosComponent
      ),
  },
  {
    path: 'videos',
    canMatch: [mediaOwnerCanMatch],
    data: {
      mediaOwnerRedirectKind: 'videos',
    },
    loadComponent: () =>
      import('./videos/profile-videos/profile-videos.component').then(
        (m) => m.ProfileVideosComponent
      ),
  },
  {
    path: 'perfil/:id/fotos',
    canMatch: [mediaOwnerCanMatch],
    data: {
      mediaOwnerSegmentIndex: 1,
      mediaOwnerRedirectKind: 'fotos',
    },
    loadComponent: () =>
      import('./photos/profile-photos/profile-photos.component').then(
        (m) => m.ProfilePhotosComponent
      ),
  },
  {
    path: 'perfil/:id/videos',
    canMatch: [mediaOwnerCanMatch],
    data: {
      mediaOwnerSegmentIndex: 1,
      mediaOwnerRedirectKind: 'videos',
    },
    loadComponent: () =>
      import('./videos/profile-videos/profile-videos.component').then(
        (m) => m.ProfileVideosComponent
      ),
  },
  {
    path: 'perfil/:id/fotos/upload',
    canMatch: [mediaOwnerCanMatch, mediaUploadEligibilityCanMatch],
    data: {
      mediaOwnerSegmentIndex: 1,
      mediaOwnerRedirectKind: 'fotos',
    },
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
