import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import type {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicPhotoAccessService } from './public-photo-access.service';

export interface PhotoPromotionPlacement {
  readonly placementId: string;
  readonly campaignId: string;
  readonly disclosure: 'Patrocinado';
  readonly photo: IPublicPhotoItem;
}

interface PlacementResponse {
  readonly placement: {
    readonly placementId: string;
    readonly campaignId: string;
    readonly disclosure: 'Patrocinado';
    readonly photo: IPublicPhotoProjection;
  } | null;
  readonly generatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class PhotoPromotionPlacementService {
  private readonly functions = inject(Functions);
  private readonly photoAccess = inject(PublicPhotoAccessService);
  private readonly mediaError = inject(MediaApplicationErrorService);

  loadPlacement$(
    organicItems: readonly IPublicPhotoItem[],
    excludedKeys: readonly string[] = []
  ): Observable<PhotoPromotionPlacement | null> {
    const organicPhotoKeys = organicItems
      .map((item) => this.photoKey(item))
      .filter(Boolean)
      .slice(0, 48);

    if (organicPhotoKeys.length < 4) {
      return of(null);
    }

    const callable = httpsCallable<
      {
        organicPhotoKeys: readonly string[];
        excludedPhotoKeys: readonly string[];
      },
      PlacementResponse
    >(this.functions, 'getPhotoPromotionPlacement');

    return defer(() =>
      from(callable({
        organicPhotoKeys,
        excludedPhotoKeys: [...new Set(excludedKeys)].slice(0, 48),
      }))
    ).pipe(
      map((response) => response.data.placement),
      switchMap((placement) => {
        if (!placement) return of(null);

        return this.photoAccess.hydratePublicPhotoUrls$([placement.photo]).pipe(
          map((items) => {
            const photo = items[0];
            return photo
              ? {
                  placementId: placement.placementId,
                  campaignId: placement.campaignId,
                  disclosure: placement.disclosure,
                  photo,
                }
              : null;
          })
        );
      }),
      catchError((error: unknown) => {
        this.mediaError.reportSilently(
          error,
          'loadPhotoPromotionPlacement',
          'Falha ao carregar placement patrocinado de foto.'
        );
        return of(null);
      })
    );
  }

  recordEvent$(
    placementId: string,
    event: 'qualified_exposure' | 'click'
  ): Observable<boolean> {
    const callable = httpsCallable<
      { placementId: string; event: 'qualified_exposure' | 'click' },
      { accepted: boolean }
    >(this.functions, 'recordPhotoPromotionEvent');

    return defer(() => from(callable({ placementId, event }))).pipe(
      map((response) => response.data.accepted === true),
      catchError((error: unknown) => {
        this.mediaError.reportSilently(
          error,
          'recordPhotoPromotionEvent',
          'Falha ao registrar evento patrocinado de foto.'
        );
        return of(false);
      })
    );
  }

  private photoKey(item: { ownerUid?: string; id?: string }): string {
    const ownerUid = String(item.ownerUid ?? '').trim();
    const id = String(item.id ?? '').trim();
    return ownerUid && id ? `${ownerUid}:${id}` : '';
  }
}
