// src/app/community/data-access/community-ownership.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP REPOSITORY
// -----------------------------------------------------------------------------
// Adapter Observable-first para callables autoritativas. O navegador não grava
// propriedade, status da Comunidade, memberships ou auditoria diretamente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';

import {
  CommunityArchiveResponse,
  CommunityOwnershipCandidatesResponse,
  CommunityOwnershipTransferResponse,
  normalizeCommunityArchiveResponse,
  normalizeCommunityOwnershipCandidatesResponse,
  normalizeCommunityOwnershipTransferResponse,
} from './community-ownership.model';

@Injectable({ providedIn: 'root' })
export class CommunityOwnershipRepository {
  private readonly functions = inject(Functions);

  private readonly getCandidatesCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunityOwnershipCandidates');

  private readonly transferOwnershipCallable = httpsCallable<
    { communityId: string; targetUid: string; requestId: string },
    unknown
  >(this.functions, 'transferCommunityOwnership');

  private readonly archiveCommunityCallable = httpsCallable<
    { communityId: string; requestId: string; reason: string | null },
    unknown
  >(this.functions, 'archiveCommunity');

  getCandidates$(
    communityId: string
  ): Observable<CommunityOwnershipCandidatesResponse> {
    return defer(() =>
      from(this.getCandidatesCallable({ communityId: communityId.trim() }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnershipCandidatesResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Lista de candidatos à propriedade inválida.');
        }

        return normalized;
      })
    );
  }

  transferOwnership$(
    communityId: string,
    targetUid: string
  ): Observable<CommunityOwnershipTransferResponse> {
    return defer(() =>
      from(
        this.transferOwnershipCallable({
          communityId: communityId.trim(),
          targetUid: targetUid.trim(),
          requestId: this.createRequestId('transfer'),
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnershipTransferResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Resposta de transferência de propriedade inválida.');
        }

        return normalized;
      })
    );
  }

  archiveCommunity$(
    communityId: string,
    reason?: string | null
  ): Observable<CommunityArchiveResponse> {
    return defer(() =>
      from(
        this.archiveCommunityCallable({
          communityId: communityId.trim(),
          requestId: this.createRequestId('archive'),
          reason: this.normalizeOptionalReason(reason),
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityArchiveResponse(result.data);

        if (!normalized) {
          throw new Error('Resposta de arquivamento da Comunidade inválida.');
        }

        return normalized;
      })
    );
  }

  private normalizeOptionalReason(reason?: string | null): string | null {
    const normalized = String(reason ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);

    return normalized || null;
  }

  private createRequestId(prefix: 'transfer' | 'archive'): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `${prefix}:${uuid}`;

    const bytes = new Uint32Array(4);
    globalThis.crypto?.getRandomValues?.(bytes);
    const entropy = Array.from(bytes, (value) => value.toString(36)).join('');
    const fallbackEntropy = entropy || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

    return `${prefix}:${fallbackEntropy}`.slice(0, 128);
  }
}
