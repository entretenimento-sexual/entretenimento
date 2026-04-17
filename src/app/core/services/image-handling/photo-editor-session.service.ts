// src/app/core/services/image-handling/photo-editor-session.service.ts
// Sessão efêmera para abrir o editor de fotos por modal,
// tanto no fluxo de criação quanto no fluxo de edição.
//
// Objetivo:
// - create: editar arquivo recém-selecionado antes do envio
// - edit: editar foto já persistida a partir da galeria
// - evitar acoplamento frágil com route state / query param
// - manter o editor reutilizável

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface IPhotoEditorCreateDraft {
  mode: 'create';
  source: 'photo-upload';
  file: File;
  ownerUid: string;
  createdAt: number;
}

export interface IPhotoEditorEditDraft {
  mode: 'edit';
  source: 'profile-photos';
  ownerUid: string;
  photoId: string;
  storedImageUrl: string;
  storedImagePath: string;
  storedImageState?: string | null;
  fileName?: string | null;
  createdAt: number;
}

export type IPhotoEditorDraft =
  | IPhotoEditorCreateDraft
  | IPhotoEditorEditDraft;

@Injectable({ providedIn: 'root' })
export class PhotoEditorSessionService {
  private readonly draftSubject = new BehaviorSubject<IPhotoEditorDraft | null>(null);

  readonly draft$: Observable<IPhotoEditorDraft | null> = this.draftSubject.asObservable();

  setCreateDraft(file: File, ownerUid: string): void {
    this.draftSubject.next({
      mode: 'create',
      source: 'photo-upload',
      file,
      ownerUid,
      createdAt: Date.now(),
    });
  }

  setEditDraft(params: {
    ownerUid: string;
    photoId: string;
    storedImageUrl: string;
    storedImagePath: string;
    storedImageState?: string | null;
    fileName?: string | null;
  }): void {
    this.draftSubject.next({
      mode: 'edit',
      source: 'profile-photos',
      ownerUid: params.ownerUid,
      photoId: params.photoId,
      storedImageUrl: params.storedImageUrl,
      storedImagePath: params.storedImagePath,
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
}