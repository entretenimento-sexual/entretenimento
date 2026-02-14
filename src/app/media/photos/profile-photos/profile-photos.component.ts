// src/app/media/photos/profile-photos/profile-photos.component.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
// Galeria do perfil (MVP + policy + viewer + link upload):
// - Policy hook via MediaPolicyService
// - Viewer via MatDialog (PhotoViewerComponent)
// - Link para rota de upload
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { Observable, of, combineLatest, EMPTY } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, switchMap, take, tap } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { MediaPolicyService, IMediaPolicyResult } from 'src/app/core/services/media/media-policy.service';
import { MediaQueryService } from 'src/app/core/services/media/media-query.service';

import { PhotoViewerComponent, IProfilePhotoItem } from '../photo-viewer/photo-viewer.component';

// ✅ Fallback tipado (evita "string" widen)
const DENY_UNKNOWN: IMediaPolicyResult = { decision: 'DENY', reason: 'UNKNOWN' };

@Component({
  selector: 'app-profile-photos',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule],
  templateUrl: './profile-photos.component.html',
  styleUrls: ['./profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePhotosComponent {
  private readonly destroyRef = inject(DestroyRef); // está esmaecido
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly mediaQuery = inject(MediaQueryService);

  private readonly DEBUG = true;
  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[ProfilePhotos] ${msg}`, data ?? '');
  }

  // UID do perfil dono das fotos (rota /perfil/:id/fotos)
  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((p) => p.get('uid') ?? ''),
    distinctUntilChanged(),
    tap((id) => this.debug('ownerUid$', id)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // UID do usuário logado (viewer)
  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) => this.debug('viewerUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Policy: pode ver?
  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([this.viewerUid$, this.ownerUid$]).pipe(
    switchMap(([viewer, owner]) => (owner ? this.policy.canViewProfilePhotos$(viewer, owner) : of(DENY_UNKNOWN))),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canView$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  // Fotos (MVP mock). Depois você troca para MediaQueryService.
  // photos$ (sem mock)
  readonly photos$: Observable<IProfilePhotoItem[]> = combineLatest([this.ownerUid$, this.canView$]).pipe(
    switchMap(([ownerUid, canView]) => {
      if (!ownerUid || !canView) return of([] as IProfilePhotoItem[]);
      return this.mediaQuery.watchProfilePhotos$(ownerUid);
    }),
    tap((items) => this.debug('photos$', { count: items.length })),
    catchError((err) => {
      this.errorNotifier.showError(err);
      return of([] as IProfilePhotoItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isEmpty$: Observable<boolean> = this.photos$.pipe(map((items) => items.length === 0), distinctUntilChanged());

  openUpload(ownerUid: string): void {
    this.router.navigate(['/perfil', ownerUid, 'fotos', 'upload']).catch(() => {
      this.errorNotifier.showError('Falha ao navegar para upload.');
    });
  }

  openPhoto(targetId: string): void {
    // Resolve índice + abre modal reativamente
    combineLatest([this.canView$, this.ownerUid$, this.photos$]).pipe(
      take(1),
      switchMap(([canView, ownerUid, items]) => {
        if (!canView) {
          this.errorNotifier.showError('Você não tem permissão para ver essas fotos.');
          return EMPTY;
        }

        const startIndex = Math.max(0, items.findIndex((i) => i.id === targetId));
        this.dialog.open(PhotoViewerComponent, {
          data: { ownerUid, items, startIndex },
          autoFocus: true,
          restoreFocus: true,
          maxWidth: '96vw',
          panelClass: 'photo-viewer-dialog',
        });

        return EMPTY;
      }),
      catchError((err) => {
        this.errorNotifier.showError(err);
        return EMPTY;
      })
    ).subscribe();
  }
}
// private readonly destroyRef = inject(DestroyRef); // está esmaecido
