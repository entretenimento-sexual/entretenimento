// src/app/explore/services/explore-personal-media.service.ts
// -----------------------------------------------------------------------------
// Fonte pessoal do feed Descobrir.
// - amigos têm precedência sobre perfis compatíveis;
// - consulta somente projeções públicas/moderadas;
// - limita autores e mídias por autor para evitar N+1 sem controle;
// - usa NgRx para amizades e shareReplay como cache reativo da sessão.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import {
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import * as FriendsPageActions from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { selectFriendsPageItems } from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';
import { AppState } from 'src/app/store/states/app.state';
import { ExploreFeedService } from './explore-feed.service';

const FRIEND_OWNER_LIMIT = 8;
const TOTAL_OWNER_LIMIT = 12;
const PHOTOS_PER_OWNER = 3;
const FRIENDS_PAGE_SIZE = 18;

export interface ExplorePersonalMediaContext {
  readonly friendUids: readonly string[];
  readonly personalPhotos: readonly IPublicPhotoItem[];
}

@Injectable({ providedIn: 'root' })
export class ExplorePersonalMediaService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly accessControl = inject(AccessControlService);
  private readonly exploreFeed = inject(ExploreFeedService);
  private readonly mediaQuery = inject(MediaPublicQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly viewerUid$ = combineLatest([
    this.accessControl.authUid$,
    this.accessControl.canRunApp$,
  ]).pipe(
    map(([uid, canRunApp]) =>
      canRunApp ? String(uid ?? '').trim() : ''
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly friendUids$: Observable<readonly string[]> = this.viewerUid$.pipe(
    switchMap((uid) =>
      uid
        ? this.store.select(selectFriendsPageItems(uid))
        : of([])
    ),
    map((items) => this.normalizeFriendUids(items).slice(0, FRIEND_OWNER_LIMIT)),
    distinctUntilChanged((previous, current) =>
      previous.join('|') === current.join('|')
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly ownerUids$: Observable<readonly string[]> = combineLatest([
    this.friendUids$,
    this.exploreFeed.compatibleProfiles$,
  ]).pipe(
    map(([friendUids, compatibleProfiles]) => {
      const ordered = new Set<string>();

      for (const uid of friendUids) {
        if (ordered.size >= TOTAL_OWNER_LIMIT) break;
        ordered.add(uid);
      }

      for (const profile of compatibleProfiles) {
        if (ordered.size >= TOTAL_OWNER_LIMIT) break;
        const uid = String(profile.uid ?? '').trim();
        if (uid) ordered.add(uid);
      }

      return [...ordered];
    }),
    distinctUntilChanged((previous, current) =>
      previous.join('|') === current.join('|')
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly personalPhotos$: Observable<readonly IPublicPhotoItem[]> =
    this.ownerUids$.pipe(
      switchMap((ownerUids) => this.loadOwnerPhotos$(ownerUids)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly context$: Observable<ExplorePersonalMediaContext> = combineLatest([
    this.friendUids$,
    this.personalPhotos$,
  ]).pipe(
    map(([friendUids, personalPhotos]) => ({
      friendUids,
      personalPhotos,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.viewerUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        if (!uid) return;

        this.store.dispatch(
          FriendsPageActions.loadFriendsFirstPage({
            uid,
            pageSize: FRIENDS_PAGE_SIZE,
          })
        );
      });
  }

  private loadOwnerPhotos$(
    ownerUids: readonly string[]
  ): Observable<readonly IPublicPhotoItem[]> {
    if (!ownerUids.length) return of([]);

    const photoSources = ownerUids.map((ownerUid) =>
      this.mediaQuery.getProfilePublicPhotos$(ownerUid).pipe(
        map((photos) =>
          [...photos]
            .sort((left, right) =>
              this.toNumber(right.publishedAt) - this.toNumber(left.publishedAt)
            )
            .slice(0, PHOTOS_PER_OWNER)
        ),
        catchError((error: unknown) => {
          this.reportOwnerError(ownerUid, error);
          return of([] as IPublicPhotoItem[]);
        })
      )
    );

    return combineLatest([
      combineLatest(photoSources),
      this.discoveryQuery.getProfilesByUids$(ownerUids, {
        cacheTTL: 300_000,
      }),
    ]).pipe(
      map(([photoGroups, profiles]) => {
        const profilesByUid = new Map<string, IUserDados>();

        for (const profile of profiles ?? []) {
          const uid = String(profile?.uid ?? '').trim();
          if (uid) profilesByUid.set(uid, profile);
        }

        const unique = new Map<string, IPublicPhotoItem>();

        for (const photo of photoGroups.flat()) {
          const key = `${photo.ownerUid}:${photo.id}`;
          if (!photo.ownerUid || !photo.id || unique.has(key)) continue;

          unique.set(
            key,
            this.withOwnerProfile(
              photo,
              profilesByUid.get(photo.ownerUid) ?? null
            )
          );
        }

        return [...unique.values()].sort(
          (left, right) =>
            this.toNumber(right.publishedAt) - this.toNumber(left.publishedAt)
        );
      }),
      catchError((error: unknown) => {
        this.reportOwnerError('profile-enrichment', error);
        return of([] as IPublicPhotoItem[]);
      })
    );
  }

  private normalizeFriendUids(items: readonly unknown[]): string[] {
    const unique = new Set<string>();

    for (const item of items ?? []) {
      const source = item as Record<string, unknown> | null;
      const uid = String(
        source?.['friendUid'] ?? source?.['uid'] ?? source?.['id'] ?? ''
      ).trim();

      if (uid) unique.add(uid);
    }

    return [...unique];
  }

  private withOwnerProfile(
    photo: IPublicPhotoItem,
    owner: IUserDados | null
  ): IPublicPhotoItem {
    if (!owner) return photo;

    return {
      ...photo,
      ownerNickname: owner.nickname ?? photo.ownerNickname ?? null,
      ownerPhotoURL: owner.photoURL ?? photo.ownerPhotoURL ?? null,
      ownerGender: owner.gender ?? photo.ownerGender ?? null,
      ownerOrientation: owner.orientation ?? photo.ownerOrientation ?? null,
      ownerMunicipio: owner.municipio ?? photo.ownerMunicipio ?? null,
      ownerEstado: owner.estado ?? photo.ownerEstado ?? null,
    };
  }

  private reportOwnerError(ownerUid: string, error: unknown): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao carregar mídia pessoal do feed.');
      const contextual = normalized as Error & {
        context?: Record<string, unknown>;
        original?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'ExplorePersonalMediaService',
        op: 'loadOwnerPhotos',
        ownerUid,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // O diagnóstico não deve interromper as demais fontes.
    }
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
