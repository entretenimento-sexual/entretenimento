import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaPhotoCommentsService } from 'src/app/core/services/media/media-photo-comments.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import {
  PublicPhotoContinuationResult,
  PublicPhotoContinuationService,
} from 'src/app/core/services/media/public-photo-continuation.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  IPhotoViewerData,
  IProfilePhotoItem,
  PhotoViewerComponent,
} from './photo-viewer.component';

function photo(ownerUid: string, id: string): IProfilePhotoItem {
  return {
    id,
    ownerUid,
    url: `https://example.test/${ownerUid}/${id}.jpg`,
    alt: `Foto ${id}`,
    ownerNickname: `Perfil ${ownerUid}`,
    ownerPhotoURL: null,
    commentsEnabled: true,
    commentsPolicy: 'EVERYONE',
    reactionsEnabled: true,
    moderationStatus: 'APPROVED',
  };
}

function publicPhoto(ownerUid: string, id: string): IPublicPhotoItem {
  return {
    ...photo(ownerUid, id),
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    createdAt: 100,
    publishedAt: 100,
    visibility: 'PUBLIC',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

describe('PhotoViewerComponent mixed-owner safety', () => {
  let fixture: ComponentFixture<PhotoViewerComponent>;
  let userSubject: BehaviorSubject<{ uid: string; nickname: string }>;
  let continuationSubject: Subject<PublicPhotoContinuationResult>;
  let data: IPhotoViewerData;

  const dialogRef = { close: vi.fn() };
  const mediaPublication = {
    recordPhotoView$: vi.fn(() => of(true)),
  };
  const comments = {
    watchVisibleComments$: vi.fn(() => of([])),
    createComment$: vi.fn(() => of('comment-1')),
    replyToComment$: vi.fn(() => of('reply-1')),
    hideComment$: vi.fn(() => of(true)),
    deleteComment$: vi.fn(() => of(true)),
  };
  const reactions = {
    getPhotoLikesCount$: vi.fn(() => of(0)),
    isPhotoLikedByViewer$: vi.fn(() => of(false)),
    toggleLikePhoto$: vi.fn(() => of({ liked: true })),
  };
  const publicPhotoContinuation = {
    loadContinuation$: vi.fn(() => continuationSubject.asObservable()),
  };
  const errorNotifier = {
    showWarning: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };
  const privacyDebug = { log: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    continuationSubject = new Subject<PublicPhotoContinuationResult>();
    userSubject = new BehaviorSubject({
      uid: 'viewer-1',
      nickname: 'Viewer',
    });
    data = {
      ownerUid: 'owner-a',
      items: [
        photo('owner-a', 'a-1'),
        photo('owner-b', 'b-1'),
      ],
      startIndex: 0,
      source: 'latest',
      continuationContext: {
        connectionOwnerUids: ['owner-b', 'friend-1'],
        compatibleOwnerUids: ['compatible-1'],
      },
    };

    await TestBed.configureTestingModule({
      imports: [PhotoViewerComponent],
      providers: [
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: userSubject.asObservable() },
        },
        { provide: MediaPublicationService, useValue: mediaPublication },
        { provide: MediaPhotoCommentsService, useValue: comments },
        { provide: MediaReactionsService, useValue: reactions },
        {
          provide: PublicPhotoContinuationService,
          useValue: publicPhotoContinuation,
        },
        { provide: ErrorNotificationService, useValue: errorNotifier },
        { provide: PrivacyDebugLoggerService, useValue: privacyDebug },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PhotoViewerComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    continuationSubject.complete();
    fixture.destroy();
  });

  it('mostra o autor ativo, CTA de perfil e motivo de descoberta', () => {
    const component = fixture.componentInstance;
    let ownerLink = fixture.nativeElement.querySelector(
      '.viewer-owner'
    ) as HTMLAnchorElement | null;

    expect(ownerLink?.getAttribute('href')).toBe('/outro-perfil/owner-a');
    expect(ownerLink?.textContent).toContain('Perfil owner-a');
    expect(ownerLink?.textContent).toContain('Recente');
    expect(ownerLink?.textContent).toContain('Ver perfil');

    component.next();
    fixture.detectChanges();
    ownerLink = fixture.nativeElement.querySelector(
      '.viewer-owner'
    ) as HTMLAnchorElement | null;

    expect(ownerLink?.getAttribute('href')).toBe('/outro-perfil/owner-b');
    expect(ownerLink?.textContent).toContain('Perfil owner-b');
    expect(ownerLink?.textContent).toContain('Da sua rede');
  });

  it('escopa reação, comentário e denúncia pelo owner da foto ativa', () => {
    const component = fixture.componentInstance;

    component.next();
    fixture.detectChanges();

    expect(component.current?.id).toBe('b-1');
    expect(component.currentOwnerUid).toBe('owner-b');

    component.toggleLike();
    expect(reactions.toggleLikePhoto$).toHaveBeenCalledWith(
      'owner-b',
      'b-1',
      'viewer-1'
    );

    component.commentControl.setValue('Comentário da fila mista');
    component.submitComment();
    expect(comments.createComment$).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'owner-b',
        photoId: 'b-1',
        authorUid: 'viewer-1',
      })
    );

    fixture.detectChanges();
    const reportLink = fixture.nativeElement.querySelector(
      'a[aria-label="Denunciar foto"]'
    ) as HTMLAnchorElement | null;

    expect(reportLink?.getAttribute('href')).toBe(
      '/media/denunciar/photo/owner-b/b-1'
    );
  });

  it('recalcula viewerIsOwner e usa a rota do próprio perfil', async () => {
    const component = fixture.componentInstance;
    userSubject.next({ uid: 'owner-b', nickname: 'Owner B' });

    component.next();
    fixture.detectChanges();

    await expect(firstValueFrom(component.viewerIsOwner$)).resolves.toBe(true);
    expect(mediaPublication.recordPhotoView$).not.toHaveBeenCalledWith(
      'owner-b',
      'b-1',
      'latest'
    );

    const ownerLink = fixture.nativeElement.querySelector(
      '.viewer-owner'
    ) as HTMLAnchorElement | null;
    expect(ownerLink?.getAttribute('href')).toBe('/perfil');
    expect(ownerLink?.textContent).toContain('Seu perfil');
  });

  it('reativa streams quando autores diferentes reutilizam o mesmo photoId', () => {
    const component = fixture.componentInstance;
    component.data.items[1] = photo('owner-b', 'a-1');
    comments.watchVisibleComments$.mockClear();

    component.next();
    fixture.detectChanges();

    expect(component.current?.id).toBe('a-1');
    expect(component.currentOwnerUid).toBe('owner-b');
    expect(comments.watchVisibleComments$).toHaveBeenCalledWith(
      'owner-b',
      'a-1'
    );
  });

  it('prefaz continuação pública, repassa contexto e avança quando o lote chega', async () => {
    const component = fixture.componentInstance;
    await Promise.resolve();

    expect(publicPhotoContinuation.loadContinuation$).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'latest',
        excludeOwnerUid: 'viewer-1',
        limit: 8,
        continuationContext: data.continuationContext,
      })
    );

    component.next();
    component.next();
    fixture.detectChanges();

    expect(component.current?.id).toBe('b-1');
    expect(component.waitingForContinuation).toBe(true);

    const nextButton = fixture.nativeElement.querySelector(
      '.viewer-nav-btn--next'
    ) as HTMLButtonElement | null;
    expect(nextButton?.disabled).toBe(true);
    expect(nextButton?.getAttribute('aria-busy')).toBe('true');
    expect(nextButton?.getAttribute('aria-label')).toBe(
      'Carregando próxima foto'
    );

    continuationSubject.next({
      items: [publicPhoto('owner-c', 'c-1')],
      exhausted: false,
      failed: false,
    });
    continuationSubject.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.current?.id).toBe('c-1');
    expect(component.currentOwnerUid).toBe('owner-c');
    expect(component.data.items).toHaveLength(3);
  });
});