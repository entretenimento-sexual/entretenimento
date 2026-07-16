// src/app/media/photos/profile-photos/profile-photos.component.ts
// Galeria privada do perfil.
//
// AJUSTES DESTA VERSÃO:
// - mantém viewer, edição e exclusão
// - adiciona VM de publicação para badges
// - adiciona ações de publicação / despublicação / capa discreta
// - adiciona organização por data escolhida pelo usuário para assinantes
// - continua tratando users/{uid}/photos como biblioteca privada
// - não mistura estado de publicação no documento privado
//
// OBSERVAÇÃO IMPORTANTE:
// - deixe publicationFeatureReady = false até as rules de:
//   1) users/{uid}/photo_publications/{photoId}
//   2) public_profiles/{uid}/photos/{photoId}
//   estarem deployadas.
// - depois do deploy correto, troque para true.
// ============================================================================
// ATENÇÃO — PENDÊNCIA TÉCNICA / EDITOR DE IMAGENS TERCEIRIZADO
// ----------------------------------------------------------------------------
// Há histórico de erro residual ligado ao software terceirizado de edição de
// imagens (Pintura), inclusive fora do fluxo explícito de edição.
//
// SINTOMA OBSERVADO:
// - erro em runtime na rota da galeria privada `/media/perfil/:id/fotos`
// - stack com mensagens como:
//   "Cannot read properties of undefined (reading 'width')"
// - em ciclos anteriores também houve erro passando por
//   `PinturaEditorComponent.initEditor` / `pqina-angular-pintura.mjs`
//
// IMPACTO:
// - o problema pode aparecer mesmo sem o usuário abrir manualmente o editor
// - isso indica acoplamento residual, carregamento indireto, bundle antecipado
//   ou comportamento instável do editor terceirizado
//
// DECISÃO ATUAL DO PROJETO:
// - NÃO bloquear a evolução da galeria privada/pública por causa deste editor
// - tratar o editor atual como solução provisória / experimental
// - manter a evolução da plataforma desacoplada do fornecedor final de edição
//
// ORIENTAÇÃO:
// - evitar novas dependências fortes do editor atual neste componente
// - preferir carregamento tardio (lazy import) para qualquer abertura de editor
// - reavaliar esta integração quando a solução definitiva de edição for escolhida
// ============================================================================
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { BehaviorSubject, EMPTY, Observable, combineLatest, from, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { MediaPolicyService, IMediaPolicyResult } from 'src/app/core/services/media/media-policy.service';
import { MediaQueryService } from 'src/app/core/services/media/media-query.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { getPhotoPublicationFeedback } from 'src/app/core/services/media/photo-publication-feedback';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { PhotoEditorSessionService } from 'src/app/core/services/image-handling/photo-editor-session.service';
import { IPhotoPublicationConfig } from 'src/app/core/interfaces/media/i-photo-publication-config';

import { PhotoViewerComponent, IProfilePhotoItem } from '../photo-viewer/photo-viewer.component';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

type IManageablePhotoItem = IProfilePhotoItem & {
  path?: string;
  fileName?: string;
  displayDate?: number | null;
  ownerUid: string;
};

type IPhotoCardVm = IManageablePhotoItem & {
  publication: IPhotoPublicationConfig;
};

type TProfilePhotoFilterMode = 'all' | 'published' | 'private';
type TProfilePhotoSortMode = 'newest' | 'oldest';

type TPhotoDateAccessUser = {
  role?: string | null;
  monthlyPayer?: boolean | null;
  subscriptionStatus?: string | null;
};

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
  private readonly destroyRef = inject(DestroyRef); // reservado para evolução futura
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly modal = inject(NgbModal);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly mediaQuery = inject(MediaQueryService);
  private readonly mediaPublicationService = inject(MediaPublicationService);
  private readonly photoFirestoreService = inject(PhotoFirestoreService);
  private readonly photoEditorSession = inject(PhotoEditorSessionService);

  // Troque para true só depois de deployar as novas rules da camada de publicação.
  readonly publicationFeatureReady = true;

  private readonly confirmDeleteIdSubject = new BehaviorSubject<string | null>(null);
  readonly confirmDeleteId$ = this.confirmDeleteIdSubject.asObservable();

  private readonly deletingPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly deletingPhotoId$ = this.deletingPhotoIdSubject.asObservable();

  private readonly publishingPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly publishingPhotoId$ = this.publishingPhotoIdSubject.asObservable();

  private readonly savingDisplayDateIdSubject = new BehaviorSubject<string | null>(null);
  readonly savingDisplayDateId$ = this.savingDisplayDateIdSubject.asObservable();

  private readonly filterModeSubject = new BehaviorSubject<TProfilePhotoFilterMode>('all');
  readonly filterMode$ = this.filterModeSubject.asObservable();

  private readonly sortModeSubject = new BehaviorSubject<TProfilePhotoSortMode>('newest');
  readonly sortMode$ = this.sortModeSubject.asObservable();

  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('media', `ProfilePhotos: ${message}`, extra);
  }

  readonly canUsePhotoDate$: Observable<boolean> = this.currentUserStore.user$.pipe(
    map((user) => this.hasPhotoDateAccess(user)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) =>
      this.debug('viewerUid$', {
        hasViewerUid: !!uid,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ownerUid$: Observable<string> = combineLatest([
    this.route.paramMap.pipe(
      map((p) => p.get('id')),
      distinctUntilChanged()
    ),
    this.viewerUid$
  ]).pipe(
    map(([routeId, viewerUid]) => routeId ?? viewerUid ?? ''),
    distinctUntilChanged(),
    tap((id) =>
      this.debug('ownerUid$', {
        hasOwnerUid: !!id,
        sameAsRouteOrSession: true,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isOwner$: Observable<boolean> = combineLatest([
    this.viewerUid$,
    this.ownerUid$,
  ]).pipe(
    map(([viewerUid, ownerUid]) => !!viewerUid && viewerUid === ownerUid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([
    this.viewerUid$,
    this.ownerUid$
  ]).pipe(
    switchMap(([viewer, owner]) => (owner ? this.policy.canViewProfilePhotos$(viewer, owner) : of(DENY_UNKNOWN))),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canView$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  readonly photos$: Observable<IManageablePhotoItem[]> = combineLatest([this.ownerUid$, this.canView$]).pipe(
    switchMap(([ownerUid, canView]) => {
      if (!ownerUid || !canView) return of([] as IManageablePhotoItem[]);
      return this.mediaQuery.watchProfilePhotos$(ownerUid);
    }),
    tap((items) => this.debug('photos$', { count: items.length })),
    catchError((err) => {
      this.errorNotifier.showError(err);
      return of([] as IManageablePhotoItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly publicationConfigs$: Observable<Record<string, IPhotoPublicationConfig>> = this.ownerUid$.pipe(
    switchMap((ownerUid) => {
      if (!ownerUid) return of({});
      return this.mediaPublicationService.getPublicationConfigsByOwner$(ownerUid);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly photoCards$: Observable<IPhotoCardVm[]> = combineLatest([
    this.ownerUid$,
    this.photos$,
    this.publicationConfigs$,
    this.filterMode$,
    this.sortMode$,
  ]).pipe(
    map(([ownerUid, photos, publicationConfigs, filterMode, sortMode]) => {
      const cards = photos.map((photo) => ({
        ...photo,
        publication:
          publicationConfigs[photo.id] ??
          this.mediaPublicationService.buildDefaultConfig(ownerUid, photo.id),
      }));

      return this.sortPhotoCards(
        this.filterPhotoCards(cards, filterMode),
        sortMode
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isEmpty$: Observable<boolean> = this.photoCards$.pipe(
    map((items) => items.length === 0),
    distinctUntilChanged()
  );

  readonly totalPhotos$: Observable<number> = this.photos$.pipe(
    map((items) => items.length),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setFilterMode(mode: TProfilePhotoFilterMode): void {
    this.filterModeSubject.next(mode);
  }

  setSortMode(mode: TProfilePhotoSortMode): void {
    this.sortModeSubject.next(mode);
  }

  getFilterModeSnapshot(): TProfilePhotoFilterMode {
    return this.filterModeSubject.value;
  }

  getSortModeSnapshot(): TProfilePhotoSortMode {
    return this.sortModeSubject.value;
  }

  getPhotoDateLabel(item: IPhotoCardVm): string {
    const displayDate = this.toMillis(item.displayDate);
    const fallbackDate = this.toMillis(item.createdAt);
    const date = displayDate || fallbackDate;

    if (!date) {
      return 'data não informada';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(date));
  }

  getDisplayDateInputValue(item: IPhotoCardVm): string {
    const displayDate = this.toMillis(item.displayDate);

    if (!displayDate) {
      return '';
    }

    const date = new Date(displayDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  updatePhotoDisplayDate(
    item: IPhotoCardVm,
    event: Event,
    canUsePhotoDate: boolean
  ): void {
    event.stopPropagation();

    const input = event.target as HTMLInputElement | null;
    const rawValue = input?.value ?? '';

    if (!canUsePhotoDate) {
      if (input) {
        input.value = this.getDisplayDateInputValue(item);
      }
      this.notifyPhotoDateUpgrade(event);
      return;
    }

    const nextDisplayDate = rawValue ? this.parseDateInputValue(rawValue) : null;

    if (rawValue && nextDisplayDate === null) {
      if (input) {
        input.value = this.getDisplayDateInputValue(item);
      }
      this.errorNotifier.showWarning('Informe uma data válida.');
      return;
    }

    combineLatest([this.isOwner$, this.ownerUid$, this.savingDisplayDateId$])
      .pipe(
        take(1),
        switchMap(([isOwner, ownerUid, savingDisplayDateId]) => {
          if (!isOwner || !ownerUid?.trim()) {
            this.errorNotifier.showError('Você não tem permissão para organizar esta foto.');
            return EMPTY;
          }

          if (savingDisplayDateId === item.id) {
            return EMPTY;
          }

          if (!item.id?.trim()) {
            this.errorNotifier.showWarning('Metadados insuficientes para atualizar a data.');
            return EMPTY;
          }

          this.savingDisplayDateIdSubject.next(item.id);

          return from(
            this.photoFirestoreService.updatePhotoDisplayDate(
              ownerUid,
              item.id,
              nextDisplayDate
            )
          ).pipe(
            tap(() => this.errorNotifier.showSuccess('Data da foto atualizada.')),
            catchError((error) => {
              if (input) {
                input.value = this.getDisplayDateInputValue(item);
              }
              this.reportError(
                'Erro ao atualizar a data da foto.',
                error,
                {
                  op: 'updatePhotoDisplayDate',
                  ownerUid,
                  photoId: item.id,
                }
              );
              return EMPTY;
            }),
            finalize(() => this.savingDisplayDateIdSubject.next(null))
          );
        })
      )
      .subscribe();
  }

  notifyPhotoDateUpgrade(event?: Event): void {
    event?.stopPropagation();
    this.errorNotifier.showWarning('Organização por data é um recurso para assinantes.');
  }

  private filterPhotoCards(
    items: readonly IPhotoCardVm[],
    mode: TProfilePhotoFilterMode
  ): IPhotoCardVm[] {
    switch (mode) {
      case 'published':
        return items.filter((item) => item.publication.isPublished);

      case 'private':
        return items.filter((item) => !item.publication.isPublished);

      default:
        return [...items];
    }
  }

  private sortPhotoCards(
    items: readonly IPhotoCardVm[],
    mode: TProfilePhotoSortMode
  ): IPhotoCardVm[] {
    return [...items].sort((a, b) => {
      const aSortDate = this.getPhotoSortDate(a);
      const bSortDate = this.getPhotoSortDate(b);

      return mode === 'oldest'
        ? aSortDate - bSortDate
        : bSortDate - aSortDate;
    });
  }

  private getPhotoSortDate(item: IPhotoCardVm): number {
    return this.toMillis(item.displayDate) || this.toMillis(item.createdAt);
  }

  private toMillis(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const maybeTimestamp = value as { toMillis?: () => number } | null | undefined;

    if (typeof maybeTimestamp?.toMillis === 'function') {
      return maybeTimestamp.toMillis();
    }

    return 0;
  }

  private parseDateInputValue(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }

    if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const date = new Date(year, month - 1, day, 12, 0, 0, 0);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date.getTime();
  }

  private hasPhotoDateAccess(user: TPhotoDateAccessUser | null | undefined): boolean {
    if (!user?.monthlyPayer || user.subscriptionStatus !== 'active') {
      return false;
    }

    return ['basic', 'premium', 'vip', 'admin'].includes(String(user.role ?? '').toLowerCase());
  }

  openUpload(ownerUid: string): void {
    this.router.navigate(['/media', 'perfil', ownerUid, 'fotos', 'upload']).catch(() => {
      this.errorNotifier.showError('Falha ao navegar para upload.');
    });
  }

  openPhoto(targetId: string): void {
    combineLatest([this.canView$, this.ownerUid$, this.photoCards$]).pipe(
      take(1),
      switchMap(([canView, ownerUid, items]) => {
        if (!canView) {
          this.errorNotifier.showError('Você não tem permissão para ver essas fotos.');
          return EMPTY;
        }

        const startIndex = Math.max(0, items.findIndex((i) => i.id === targetId));

        this.dialog.open(PhotoViewerComponent, {
          data: { ownerUid, items, startIndex },
          autoFocus: false,
          restoreFocus: true,
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          panelClass: ['photo-viewer-dialog', 'photo-viewer-dialog--immersive'],
          backdropClass: 'photo-viewer-backdrop',
        });

        return EMPTY;
      }),
      catchError((err) => {
        this.errorNotifier.showError(err);
        return EMPTY;
      })
    ).subscribe();
  }

  editPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    combineLatest([this.isOwner$, this.ownerUid$])
      .pipe(take(1))
      .subscribe(async ([isOwner, ownerUid]) => {
        if (!isOwner) {
          this.errorNotifier.showError('Você não tem permissão para editar esta foto.');
          return;
        }

        if (!item.id?.trim() || !item.path?.trim() || !item.url?.trim()) {
          this.errorNotifier.showError('Metadados insuficientes para editar esta foto.');
          return;
        }

        this.photoEditorSession.setEditDraft({
          ownerUid,
          photoId: item.id,
          storedImageUrl: item.url,
          storedImagePath: item.path,
          storedImageState: null,
          fileName: item.fileName ?? item.alt ?? null,
        });

        try {
          const { PhotoEditorComponent } = await import(
            'src/app/photo-editor/photo-editor/photo-editor.component'
          );

          const modalRef = this.modal.open(PhotoEditorComponent, {
            size: 'xl',
            centered: true,
            backdrop: 'static',
            keyboard: false,
            scrollable: true,
            windowClass: 'photo-editor-modal-window',
          });

          const payload = await modalRef.result;

          if (!payload || payload.reason !== 'updateSuccess' || !payload.photo) {
            return;
          }

          this.errorNotifier.showSuccess('Foto atualizada com sucesso.');
        } catch (error) {
          // dismiss do modal: não tratar como erro visível
          if (error !== 'close' && error !== 'dismiss') {
            this.reportError(
              'Erro ao abrir o editor da foto.',
              error,
              {
                op: 'editPhoto',
                ownerUid,
                photoId: item.id,
              }
            );
          }
        } finally {
          this.photoEditorSession.clearDraft();
        }
      });
  }

  requestDelete(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();
    this.confirmDeleteIdSubject.next(item.id);
  }

  cancelDelete(event?: Event): void {
    event?.stopPropagation();
    this.confirmDeleteIdSubject.next(null);
  }

  confirmDelete(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    combineLatest([this.isOwner$, this.ownerUid$, this.deletingPhotoId$])
      .pipe(take(1))
      .subscribe(([isOwner, ownerUid, deletingPhotoId]) => {
        if (!isOwner) {
          this.errorNotifier.showError('Você não tem permissão para excluir esta foto.');
          return;
        }

        if (deletingPhotoId === item.id) {
          return;
        }

        if (!item.id?.trim() || !item.path?.trim()) {
          this.errorNotifier.showWarning('Metadados insuficientes para excluir esta foto.');
          return;
        }

        this.deletingPhotoIdSubject.next(item.id);

        from(this.photoFirestoreService.deletePhoto(ownerUid, item.id, item.path))
          .pipe(
            finalize(() => {
              this.deletingPhotoIdSubject.next(null);
              this.confirmDeleteIdSubject.next(null);
            }),
            catchError((error) => {
              this.reportError(
                'Erro ao excluir a foto.',
                error,
                {
                  op: 'confirmDelete',
                  ownerUid,
                  photoId: item.id,
                  photoPath: item.path,
                }
              );
              return EMPTY;
            })
          )
          .subscribe(() => {
            this.errorNotifier.showSuccess('Foto excluída com sucesso.');
          });
      });
  }

  private canManagePhotoPublication$(): Observable<{
    canManage: boolean;
    ownerUid: string;
  }> {
    return combineLatest([this.isOwner$, this.ownerUid$]).pipe(
      take(1),
      map(([isOwner, ownerUid]) => ({
        canManage: !!isOwner && !!ownerUid?.trim(),
        ownerUid: ownerUid ?? '',
      }))
    );
  }

  publishPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    if (!this.publicationFeatureReady) {
      this.errorNotifier.showWarning(
        'A publicação de fotos ainda está desabilitada até a camada pública estar pronta.'
      );
      return;
    }

    this.canManagePhotoPublication$()
      .pipe(
        switchMap(({ canManage, ownerUid }) => {
          if (!canManage) {
            this.errorNotifier.showError('Você não tem permissão para publicar esta foto.');
            return EMPTY;
          }

          if (!item.id?.trim() || !item.url?.trim()) {
            this.errorNotifier.showWarning('Metadados insuficientes para publicar esta foto.');
            return EMPTY;
          }

          this.publishingPhotoIdSubject.next(item.id);

          return this.mediaPublicationService.publishPhoto$({
            ownerUid,
            photo: {
              id: item.id,
              ownerUid,
              url: item.url,
              alt: item.alt,
              createdAt: item.createdAt ?? 0,
              path: item.path,
              fileName: item.fileName,
            },
            visibility: 'PUBLIC',
            isCover: !!item.publication.isCover,
            orderIndex: item.publication.orderIndex ?? 0,
            commentsEnabled: true,
            commentsPolicy: 'EVERYONE',
            reactionsEnabled: true,
          }).pipe(
            tap((result) => {
              const feedback = getPhotoPublicationFeedback(result);

              if (feedback.kind === 'warning') {
                this.errorNotifier.showWarning(feedback.message);
                return;
              }

              this.errorNotifier.showSuccess(feedback.message);
            }),
            catchError((error) => {
              this.reportError(
                'Erro ao publicar a foto.',
                error,
                {
                  op: 'publishPhoto',
                  ownerUid,
                  photoId: item.id,
                }
              );

              return EMPTY;
            }),
            finalize(() => this.publishingPhotoIdSubject.next(null))
          );
        })
      )
      .subscribe();
  }

  unpublishPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    if (!this.publicationFeatureReady) {
      this.errorNotifier.showWarning(
        'A publicação de fotos ainda está desabilitada até a camada pública estar pronta.'
      );
      return;
    }

    this.canManagePhotoPublication$()
      .pipe(
        switchMap(({ canManage, ownerUid }) => {
          if (!canManage) {
            this.errorNotifier.showError('Você não tem permissão para despublicar esta foto.');
            return EMPTY;
          }

          if (!item.id?.trim()) {
            this.errorNotifier.showWarning('Metadados insuficientes para despublicar esta foto.');
            return EMPTY;
          }

          this.publishingPhotoIdSubject.next(item.id);

          return this.mediaPublicationService.unpublishPhoto$(ownerUid, item.id).pipe(
            tap(() => {
              this.errorNotifier.showSuccess('Foto despublicada com sucesso.');
            }),
            catchError((error) => {
              this.reportError(
                'Erro ao despublicar a foto.',
                error,
                {
                  op: 'unpublishPhoto',
                  ownerUid,
                  photoId: item.id,
                }
              );

              return EMPTY;
            }),
            finalize(() => this.publishingPhotoIdSubject.next(null))
          );
        })
      )
      .subscribe();
  }

  setCoverPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    if (!this.publicationFeatureReady) {
      this.errorNotifier.showWarning(
        'A publicação de fotos ainda está desabilitada até a camada pública estar pronta.'
      );
      return;
    }

    this.canManagePhotoPublication$()
      .pipe(
        switchMap(({ canManage, ownerUid }) => {
          if (!canManage) {
            this.errorNotifier.showError('Você não tem permissão para definir capa.');
            return EMPTY;
          }

          if (!item.id?.trim()) {
            this.errorNotifier.showWarning('Metadados insuficientes para definir capa.');
            return EMPTY;
          }

          this.publishingPhotoIdSubject.next(item.id);

          return this.mediaPublicationService.setCoverPhoto$(ownerUid, item.id).pipe(
            tap(() => {
              this.errorNotifier.showSuccess('Foto de capa atualizada.');
            }),
            catchError((error) => {
              this.reportError(
                'Erro ao definir foto de capa.',
                error,
                {
                  op: 'setCoverPhoto',
                  ownerUid,
                  photoId: item.id,
                }
              );

              return EMPTY;
            }),
            finalize(() => this.publishingPhotoIdSubject.next(null))
          );
        })
      )
      .subscribe();
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'ProfilePhotosComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }

    this.debug('reportError', {
      userMessage,
      op: context?.['op'] ?? 'unknown',
      hasContext: !!context,
      errorMessage: error instanceof Error ? error.message : String(error ?? ''),
    });
  }
}
