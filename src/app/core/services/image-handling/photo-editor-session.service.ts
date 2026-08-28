// src/app/core/services/image-handling/photo-editor-session.service.ts
// Sessão efêmera do editor canônico de imagens.
//
// O editor nunca persiste mídia. Esta sessão transporta somente a origem e o
// contexto visual necessários para processar a imagem; o consumidor mantém os
// identificadores de Firestore/Storage e decide o destino após o resultado.

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import {
  PhotoEditorContext,
  PhotoEditorPreset,
} from './photo-editor-result.model';

export type PhotoEditorCreateSource =
  | 'photo-upload'
  | 'global-photo-upload'
  | 'explore-publication'
  | 'community-feed-camera'
  | 'community-feed-gallery'
  | 'profile-avatar'
  | 'community-cover'
  | 'generic';

export type PhotoEditorSource = PhotoEditorCreateSource | 'profile-photos';

export interface PhotoEditorCreateOptions {
  readonly context?: PhotoEditorContext;
  readonly preset?: PhotoEditorPreset;
}

interface PhotoEditorDraftBase {
  readonly source: PhotoEditorSource;
  readonly context: PhotoEditorContext;
  readonly preset: PhotoEditorPreset;
  readonly ownerUid: string;
  readonly createdAt: number;
}

export interface IPhotoEditorCreateDraft extends PhotoEditorDraftBase {
  readonly mode: 'create';
  readonly file: File;
}

export interface IPhotoEditorEditDraft extends PhotoEditorDraftBase {
  readonly mode: 'edit';
  readonly source: 'profile-photos';
  readonly storedImageUrl: string;
  readonly storedImageState?: string | null;
  readonly fileName?: string | null;
}

export type IPhotoEditorDraft =
  | IPhotoEditorCreateDraft
  | IPhotoEditorEditDraft;

@Injectable({ providedIn: 'root' })
export class PhotoEditorSessionService {
  private readonly draftSubject = new BehaviorSubject<IPhotoEditorDraft | null>(null);

  readonly draft$: Observable<IPhotoEditorDraft | null> = this.draftSubject.asObservable();

  setCreateDraft(
    file: File,
    ownerUid: string,
    source: PhotoEditorCreateSource = 'photo-upload',
    options: PhotoEditorCreateOptions = {}
  ): void {
    const defaults = this.resolveSourceDefaults(source);

    this.draftSubject.next({
      mode: 'create',
      source,
      context: options.context ?? defaults.context,
      preset: options.preset ?? defaults.preset,
      file,
      ownerUid,
      createdAt: Date.now(),
    });
  }

  setEditDraft(params: {
    ownerUid: string;
    storedImageUrl: string;
    storedImageState?: string | null;
    fileName?: string | null;
  }): void {
    this.draftSubject.next({
      mode: 'edit',
      source: 'profile-photos',
      context: 'profile-photo',
      preset: 'profile-photo',
      ownerUid: params.ownerUid,
      storedImageUrl: params.storedImageUrl,
      storedImageState: params.storedImageState ?? null,
      fileName: params.fileName ?? null,
      createdAt: Date.now(),
    });
  }

  peekDraft(): IPhotoEditorDraft | null {
    return this.draftSubject.value;
  }

  clearDraft(): void {
    this.draftSubject.next(null);
  }

  private resolveSourceDefaults(source: PhotoEditorCreateSource): {
    context: PhotoEditorContext;
    preset: PhotoEditorPreset;
  } {
    switch (source) {
      case 'community-feed-camera':
      case 'community-feed-gallery':
        return { context: 'community-feed', preset: 'social-feed' };
      case 'explore-publication':
        return { context: 'social-feed', preset: 'social-feed' };
      case 'profile-avatar':
        return { context: 'profile-avatar', preset: 'avatar-square' };
      case 'community-cover':
        return { context: 'community-cover', preset: 'community-cover' };
      case 'photo-upload':
        return { context: 'profile-photo', preset: 'profile-photo' };
      case 'global-photo-upload':
      default:
        return { context: 'generic', preset: 'free' };
    }
  }
}
