// src/app/core/services/media/media-policy.service.ts
// Policy reativa de mídia privada e publicação controlada.
// A UI antecipa a decisão, enquanto Functions e Rules permanecem autoridades.
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';

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
  accountStatus?: string | null;
  suspended?: boolean | null;
  interactionBlocked?: boolean | null;
  accountLocked?: boolean | null;
  loginAllowed?: boolean | null;
  ageReverificationStatus?: string | null;
}

const AGE_REVERIFICATION_RESTRICTED_STATES = new Set([
  'REQUIRED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
]);

@Injectable({ providedIn: 'root' })
export class MediaPolicyService {
  private readonly currentUserStore = inject(CurrentUserStoreService);

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

  /** Compatibilidade com chamadas antigas que validam somente ownership. */
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

    return this.currentUserStore.user$.pipe(
      map((currentUser): IMediaPolicyViewerSnapshot | null | undefined => {
        if (!currentUser) {
          return currentUser;
        }

        return {
          uid: currentUser.uid,
          emailVerified: currentUser.emailVerified === true,
          profileCompleted: currentUser.profileCompleted === true,
          accountStatus: currentUser.accountStatus ?? null,
          suspended: currentUser.suspended === true,
          interactionBlocked: currentUser.interactionBlocked === true,
          accountLocked: currentUser.accountLocked === true,
          loginAllowed: currentUser.loginAllowed,
          ageReverificationStatus:
            currentUser.ageReverification?.status ?? null,
        };
      }),
      map((currentViewer) =>
        this.evaluateUploadPolicy(currentViewer ?? viewer, ownerUid)
      ),
      distinctUntilChanged((previous, current) =>
        previous.decision === current.decision &&
        previous.reason === current.reason
      )
    );
  }

  private evaluateUploadPolicy(
    viewer: IMediaPolicyViewerSnapshot | null | undefined,
    ownerUid: string
  ): IMediaPolicyResult {
    if (viewer === undefined) {
      return { decision: 'DENY', reason: 'UNKNOWN' };
    }

    const safeViewerUid = (viewer?.uid ?? '').trim();
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeViewerUid) {
      return { decision: 'DENY', reason: 'NOT_AUTHENTICATED' };
    }

    if (!safeOwnerUid || safeViewerUid !== safeOwnerUid) {
      return { decision: 'DENY', reason: 'NOT_OWNER' };
    }

    const accountStatus = String(viewer?.accountStatus ?? 'active')
      .trim()
      .toLowerCase();
    const ageStatus = String(viewer?.ageReverificationStatus ?? '')
      .trim()
      .toUpperCase();

    if (
      accountStatus !== 'active' ||
      viewer?.suspended === true ||
      viewer?.accountLocked === true ||
      viewer?.loginAllowed === false ||
      AGE_REVERIFICATION_RESTRICTED_STATES.has(ageStatus)
    ) {
      return { decision: 'DENY', reason: 'BLOCKED' };
    }

    if (viewer?.interactionBlocked === true) {
      return { decision: 'DENY', reason: 'INTERACTION_BLOCKED' };
    }

    if (viewer?.emailVerified !== true) {
      return { decision: 'DENY', reason: 'EMAIL_UNVERIFIED' };
    }

    if (viewer?.profileCompleted !== true) {
      return { decision: 'DENY', reason: 'PROFILE_INCOMPLETE' };
    }

    return { decision: 'ALLOW' };
  }
}
