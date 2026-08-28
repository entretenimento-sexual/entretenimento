import { Injectable, inject } from '@angular/core';
import type { User } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { Observable, defer, of } from 'rxjs';
import { map, shareReplay, take } from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import type { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';

/**
 * Replacements exclusivos das configurações `*-explore-social-visual`.
 *
 * SUPRESSÃO EXPLÍCITA DO HARNESS:
 * - não autentica conta real;
 * - não consulta Firestore/Functions;
 * - não publica, reage ou grava visualização real.
 *
 * Motivo: o CI deve exercitar template/CSS/componentes reais de `/descobrir`
 * com dados determinísticos, sem alterar backends de dev/prod/emu.
 */

export interface ExplorePersonalMediaContext {
  readonly friendUids: readonly string[];
  readonly personalPhotos: readonly IPublicPhotoItem[];
  readonly personalVideos: readonly IPublicVideoItem[];
}

export interface IPublicMediaReactionState {
  readonly liked: boolean;
  readonly reactionsCount: number;
  readonly score: number;
}

export type TPhotoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

type VisualState = 'feed' | 'empty' | 'video-error';

const VISUAL_USER = {
  uid: 'visual-viewer',
  email: 'visual@example.com',
  nickname: 'Alex Visual',
  photoURL: null,
  estado: 'RJ',
  municipio: 'Rio de Janeiro',
  profileCompleted: true,
  accountStatus: 'active',
  publicVisibility: 'visible',
  interactionBlocked: false,
} as IUserDados;

const VISUAL_COMPATIBLES: readonly PublicProfileCard[] = [
  profile('visual-compatible-1', 'Marina', 31),
  profile('visual-compatible-2', 'Rafael', 34),
  profile('visual-compatible-3', 'Bianca', 29),
];

const VISUAL_PHOTOS: readonly IPublicPhotoItem[] = [
  photo('photo-friend-1', 'visual-friend', 'Camila', 12),
  photo('photo-friend-2', 'visual-friend', 'Camila', 28),
  photo('photo-compatible-1a', 'visual-compatible-1', 'Marina', 18),
  photo('photo-compatible-1b', 'visual-compatible-1', 'Marina', 42),
  photo('photo-compatible-2a', 'visual-compatible-2', 'Rafael', 24),
  photo('photo-compatible-2b', 'visual-compatible-2', 'Rafael', 55),
];

const VISUAL_VIDEOS: readonly IPublicVideoItem[] = [
  video('video-friend', 'visual-friend', 'Camila', 'Encontro no fim da tarde', 16),
  video('video-compatible-1', 'visual-compatible-1', 'Marina', 'Um pouco do meu dia', 35),
  video('video-compatible-2', 'visual-compatible-2', 'Rafael', 'Passeio pela cidade', 48),
];

const VISUAL_HIGHLIGHTS: readonly IPublicVideoItem[] = [
  video('highlight-1', 'visual-highlight-1', 'Luana', 'Destaque da comunidade', 8),
  video('highlight-2', 'visual-highlight-2', 'Diego', 'Momento em destaque', 22),
  video('highlight-3', 'visual-highlight-3', 'Nina', 'Novidades por aqui', 39),
];

const VISUAL_STATUS: IUserIntentStatusCardVm = {
  id: 'status-visual-friend',
  uid: 'visual-friend',
  profile: {
    uid: 'visual-friend',
    nickname: 'Camila',
    photoURL: null,
    age: 30,
  },
  availability: 'available_today',
  visibility: 'public_discovery',
  destination: {
    kind: 'region',
    label: 'Zona Sul',
    region: { uf: 'RJ', city: 'rio de janeiro' },
  },
  moderation: { state: 'active' },
  startsAt: Date.now() - 20 * 60_000,
  expiresAt: Date.now() + 5 * 60 * 60_000,
  createdAt: Date.now() - 20 * 60_000,
  updatedAt: Date.now() - 20 * 60_000,
  destinationLabel: 'Zona Sul · rio de janeiro, RJ',
  availabilityLabel: 'Disponível hoje',
  expiresInLabel: 'Expira em 5h',
  isActive: true,
};

@Injectable({ providedIn: 'root' })
export class ExploreFeedFacade {
  private readonly router = inject(Router);

  readonly vm$: Observable<any> = defer(() => {
    const state = readVisualState(this.router.url);
    const empty = state === 'empty';
    const videoError = state === 'video-error';

    return of({
      boostedPhotos: [],
      mostViewedPhotos: [],
      topPhotos: [],
      latestPhotos: empty ? [] : [...VISUAL_PHOTOS],
      videoHighlights: videoError || empty ? [] : [...VISUAL_HIGHLIGHTS],
      videoHighlightsStatus: videoError ? 'error' : empty ? 'empty' : 'ready',
      sections: [],
      compatibleProfiles: [...VISUAL_COMPATIBLES],
      totalItems: empty ? 0 : VISUAL_PHOTOS.length + VISUAL_HIGHLIGHTS.length,
      hasAnyContent: !empty,
    });
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  retryVideoHighlights(): void {
    // O estado de erro é proposital e determinístico no harness.
  }
}

@Injectable({ providedIn: 'root' })
export class ExplorePersonalMediaService {
  private readonly router = inject(Router);

  readonly context$: Observable<ExplorePersonalMediaContext> = defer(() => {
    const empty = readVisualState(this.router.url) === 'empty';

    return of({
      friendUids: empty ? [] : ['visual-friend'],
      personalPhotos: empty ? [] : [...VISUAL_PHOTOS],
      personalVideos: empty ? [] : [...VISUAL_VIDEOS],
    });
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
}

@Injectable({ providedIn: 'root' })
export class CompatibleProfileCandidatesService {
  readonly profiles$ = of([...VISUAL_COMPATIBLES]).pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly ownerUids$ = this.profiles$.pipe(
    map((profiles) => profiles.map((profile) => profile.uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly visualAuthUser = {
    uid: VISUAL_USER.uid,
    email: VISUAL_USER.email,
    emailVerified: true,
    getIdToken: () => Promise.resolve('visual-token'),
    reload: () => Promise.resolve(),
  } as unknown as User;

  readonly authUser$: Observable<User | null> = of(this.visualAuthUser);
  readonly uid$: Observable<string | null> = of(VISUAL_USER.uid);
  readonly ready$: Observable<boolean> = of(true);
  readonly emailVerified$: Observable<boolean> = of(true);
  readonly isAuthenticated$: Observable<boolean> = of(true);
  readonly readyAuthUser$: Observable<User | null> = of(this.visualAuthUser);
  readonly readyUid$: Observable<string | null> = of(VISUAL_USER.uid);

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  refreshCurrentUser$(): Observable<User | null> {
    return of(this.visualAuthUser);
  }

  signOut$(): Observable<void> {
    return of(void 0);
  }

  get currentAuthUser(): User | null {
    return this.visualAuthUser;
  }
}

export function normalizeCurrentUserRuntimeVisibility(user: IUserDados): IUserDados {
  return user;
}

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  readonly user$: Observable<IUserDados | null | undefined> = of(VISUAL_USER);

  set(_user: IUserDados): void {}
  patch(_partial: Partial<IUserDados>): void {}
  setUnavailable(): void {}
  clear(): void {}
  markUnhydrated(): void {}

  getSnapshot(): IUserDados | null | undefined {
    return VISUAL_USER;
  }

  isHydratedOnce$(): Observable<boolean> {
    return of(true).pipe(take(1));
  }

  isResolved$(): Observable<boolean> {
    return of(true);
  }

  hasProfile$(): Observable<boolean> {
    return of(true);
  }

  getAuthReady$(): Observable<boolean> {
    return of(true);
  }

  getLoggedUserUID$(): Observable<string | null> {
    return of(VISUAL_USER.uid);
  }

  getLoggedUserUIDSnapshot(): string | null {
    return VISUAL_USER.uid;
  }

  getLoggedUserUIDOnce$(): Observable<string | null> {
    return of(VISUAL_USER.uid).pipe(take(1));
  }

  restoreFromCache(): IUserDados | null {
    return VISUAL_USER;
  }

  restoreFromCacheForUid(uid: string | null | undefined): IUserDados | null {
    return String(uid ?? '').trim() === VISUAL_USER.uid ? VISUAL_USER : null;
  }
}

@Injectable({ providedIn: 'root' })
export class UserIntentStatusService {
  private readonly router = inject(Router);

  watchCurrentStatus$(_uid: string): Observable<IUserIntentStatusCardVm | null> {
    return of(null);
  }

  watchActiveStatusesForUserRegion$(
    _uid: string,
    _options: unknown = {}
  ): Observable<IUserIntentStatusCardVm[]> {
    return readVisualState(this.router.url) === 'empty'
      ? of([])
      : of([VISUAL_STATUS]);
  }

  watchActiveStatusesForRegion$(
    _region: unknown,
    _options: unknown = {}
  ): Observable<IUserIntentStatusCardVm[]> {
    return this.watchActiveStatusesForUserRegion$(VISUAL_USER.uid, _options);
  }

  publishStatus$(_input: unknown): Observable<void> {
    return of(void 0);
  }

  hideCurrentStatus$(_uid: string): Observable<void> {
    return of(void 0);
  }
}

@Injectable({ providedIn: 'root' })
export class VenueService {
  watchVenuesForRegion$(_region: unknown, _options?: unknown): Observable<any[]> {
    return of([]);
  }
}

@Injectable({ providedIn: 'root' })
export class MediaReactionsService {
  getPhotoLikesCount$(_ownerUid: string, _photoId: string): Observable<number> {
    return of(12);
  }

  getVideoLikesCount$(_ownerUid: string, _videoId: string): Observable<number> {
    return of(18);
  }

  isPhotoLikedByViewer$(
    _ownerUid: string,
    _photoId: string,
    _viewerUid: string | null
  ): Observable<boolean> {
    return of(false);
  }

  isVideoLikedByViewer$(
    _ownerUid: string,
    _videoId: string,
    _viewerUid: string | null
  ): Observable<boolean> {
    return of(false);
  }

  toggleLikePhotoWithState$(
    _ownerUid: string,
    _photoId: string,
    _viewerUid: string | null
  ): Observable<IPublicMediaReactionState | null> {
    return of({ liked: true, reactionsCount: 13, score: 0 });
  }

  toggleLikeVideoWithState$(
    _ownerUid: string,
    _videoId: string,
    _viewerUid: string | null
  ): Observable<IPublicMediaReactionState | null> {
    return of({ liked: true, reactionsCount: 19, score: 0 });
  }

  toggleLikePhoto$(
    _ownerUid: string,
    _photoId: string,
    _viewerUid: string | null
  ): Observable<void> {
    return of(void 0);
  }

  toggleLikeVideo$(
    _ownerUid: string,
    _videoId: string,
    _viewerUid: string | null
  ): Observable<void> {
    return of(void 0);
  }
}

@Injectable({ providedIn: 'root' })
export class PhotoViewTrackingService {
  recordPhotoView$(
    _ownerUid: string,
    _photoId: string,
    _source: TPhotoViewSource = 'unknown'
  ): Observable<void> {
    return of(void 0);
  }
}

function readVisualState(url: string): VisualState {
  const query = String(url ?? '').split('?')[1] ?? '';
  const state = new URLSearchParams(query).get('visualState');
  return state === 'empty' || state === 'video-error' ? state : 'feed';
}

function profile(uid: string, nickname: string, age: number): PublicProfileCard {
  return {
    uid,
    nickname,
    nicknameNormalized: nickname.toLowerCase(),
    photoURL: null,
    gender: 'não informado',
    orientation: 'não informada',
    age,
    municipio: 'Rio de Janeiro',
    estado: 'RJ',
    role: 'free',
    isOnline: true,
    lastSeen: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    publicRelationshipIntents: ['dating'],
    preferenceBadgesVisible: true,
    publicPreferencesUpdatedAt: Date.now() - 60_000,
  } as PublicProfileCard;
}

function photo(
  id: string,
  ownerUid: string,
  ownerNickname: string,
  minutesAgo: number
): IPublicPhotoItem {
  const publishedAt = Date.now() - minutesAgo * 60_000;

  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    url: 'assets/imagem-padrao.webp',
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    orderIndex: 0,
    commentsEnabled: true,
    reactionsEnabled: true,
    moderationStatus: 'APPROVED',
    ownerNickname,
    ownerPhotoURL: null,
    ownerGender: null,
    ownerOrientation: null,
    ownerMunicipio: 'Rio de Janeiro',
    ownerEstado: 'RJ',
    reactionsCount: 12,
    commentsCount: 3,
    viewsCount: 80,
  } as IPublicPhotoItem;
}

function video(
  id: string,
  ownerUid: string,
  nickname: string,
  title: string,
  minutesAgo: number
): IPublicVideoItem {
  const publishedAt = Date.now() - minutesAgo * 60_000;

  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title,
    description: null,
    alt: title,
    mimeType: 'video/mp4',
    sizeBytes: 2_048,
    durationMs: 42_000,
    createdAt: publishedAt,
    publishedAt,
    updatedAt: publishedAt,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 120,
    uniqueViewersCount: 76,
    reactionsCount: 18,
    commentsCount: 4,
    ratingsCount: 0,
    ratingAverage: 0,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 0,
    engagementScore: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 100,
    },
    owner: {
      nickname,
      photoURL: null,
      gender: null,
      orientation: null,
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
    },
    url: null,
    posterUrl: 'assets/imagem-padrao.webp',
    accessExpiresAt: Date.now() + 60 * 60_000,
  };
}
