// src/app/core/services/media/media-policy.service.ts
// Policy central de mídia privada e publicação controlada.
// - somente o dono acessa bibliotecas privadas;
// - upload exige e-mail verificado, perfil concluído e conta sem bloqueio;
// - fotos e vídeos compartilham a mesma defesa em profundidade.
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export type MediaPolicyDecision = 'ALLOW' | 'DENY';

export type MediaPolicyDenyReason =
  | 'NOT_AUTHENTICATED'
  | 'NOT_OWNER'
  | 'EMAIL_UNVERIFIED'
  | 'PROFILE_INCOMPLETE'
  | 'INTERACTION_BLOCKED'
  | 'BLOCKED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'UNKNOWN';

export interface IMediaPolicyResult {
  decision: MediaPolicyDecision;
  reason?: MediaPolicyDenyReason;
}

export interface IMediaPolicyViewerSnapshot {
  uid?: string | null;
  emailVerified?: boolean | null;
  profileCompleted?: boolean | null;
  interactionBlocked?: boolean | null;
}

@Injectable({ providedIn: 'root' })
export class MediaPolicyService {
  private allow$(): Observable<IMediaPolicyResult> {
    return of<IMediaPolicyResult>({ decision: 'ALLOW' });
  }

  private deny$(
    reason: NonNullable<IMediaPolicyResult['reason']>
  ): Observable<IMediaPolicyResult> {
    return of<IMediaPolicyResult>({ decision: 'DENY', reason });
  }

  canViewProfilePhotos$(
    viewerUid: string | null,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    return this.canViewOwnedLibrary$(viewerUid, ownerUid);
  }

  canViewProfileVideos$(
    viewerUid: string | null,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    return this.canViewOwnedLibrary$(viewerUid, ownerUid);
  }

  /**
   * Compatibilidade com chamadas antigas que ainda informam apenas UID.
   * Mantida para não quebrar componentes que só precisam validar ownership.
   */
  canUploadProfilePhotos$(
    viewerUid: string | null,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    return this.canViewOwnedLibrary$(viewerUid, ownerUid);
  }

  canUploadProfileVideos$(
    viewerUid: string | null,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    return this.canViewOwnedLibrary$(viewerUid, ownerUid);
  }

  canUploadProfilePhotosForViewer$(
    viewer: IMediaPolicyViewerSnapshot | null | undefined,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    return this.canUploadProfileMediaForViewer$(viewer, ownerUid);
  }

  canUploadProfileVideosForViewer$(
    viewer: IMediaPolicyViewerSnapshot | null | undefined,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    return this.canUploadProfileMediaForViewer$(viewer, ownerUid);
  }

  private canViewOwnedLibrary$(
    viewerUid: string | null,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    const safeViewerUid = (viewerUid ?? '').trim();
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeViewerUid) {
      return this.deny$('NOT_AUTHENTICATED');
    }

    if (!safeOwnerUid || safeViewerUid !== safeOwnerUid) {
      return this.deny$('NOT_OWNER');
    }

    return this.allow$();
  }

  private canUploadProfileMediaForViewer$(
    viewer: IMediaPolicyViewerSnapshot | null | undefined,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    if (viewer === undefined) {
      return this.deny$('UNKNOWN');
    }

    const safeViewerUid = (viewer?.uid ?? '').trim();
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeViewerUid) {
      return this.deny$('NOT_AUTHENTICATED');
    }

    if (!safeOwnerUid || safeViewerUid !== safeOwnerUid) {
      return this.deny$('NOT_OWNER');
    }

    if (viewer?.interactionBlocked === true) {
      return this.deny$('INTERACTION_BLOCKED');
    }

    if (viewer?.emailVerified !== true) {
      return this.deny$('EMAIL_UNVERIFIED');
    }

    if (viewer?.profileCompleted !== true) {
      return this.deny$('PROFILE_INCOMPLETE');
    }

    return this.allow$();
  }
}
