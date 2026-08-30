import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityHighlightManageRequest,
  CommunityHighlightManageResponse,
  CommunityHighlightReadRequest,
  CommunityHighlightReadResponse,
  normalizeCommunityHighlightManageResponse,
  normalizeCommunityHighlightReadResponse,
} from './community-highlight.model';

export function buildCommunityHighlightManagePayload(
  request: CommunityHighlightManageRequest
): CommunityHighlightManageRequest {
  const action = request.action;
  return {
    requestId: request.requestId.trim(),
    communityId: request.communityId.trim(),
    action,
    targetType: action === 'pin' ? request.targetType ?? 'feed_post' : null,
    targetId: action === 'pin' ? request.targetId?.trim() || null : null,
    duration: action === 'pin' ? request.duration ?? '7d' : null,
  };
}

@Injectable({ providedIn: 'root' })
export class CommunityHighlightRepository {
  private readonly functions = inject(Functions);
  private readonly getCallable = httpsCallable<CommunityHighlightReadRequest, unknown>(
    this.functions,
    'getCommunityHighlight'
  );
  private readonly manageCallable = httpsCallable<CommunityHighlightManageRequest, unknown>(
    this.functions,
    'manageCommunityHighlight'
  );

  get$(request: CommunityHighlightReadRequest): Observable<CommunityHighlightReadResponse> {
    const payload = { communityId: request.communityId.trim() };
    return defer(() => from(this.getCallable(payload))).pipe(
      map((result) => normalizeCommunityHighlightReadResponse(result.data))
    );
  }

  manage$(request: CommunityHighlightManageRequest): Observable<CommunityHighlightManageResponse> {
    const payload = buildCommunityHighlightManagePayload(request);
    return defer(() => from(this.manageCallable(payload))).pipe(
      map((result) => normalizeCommunityHighlightManageResponse(result.data))
    );
  }
}
