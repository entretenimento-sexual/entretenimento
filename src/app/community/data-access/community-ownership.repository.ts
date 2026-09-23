// src/app/community/data-access/community-ownership.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP REPOSITORY
// -----------------------------------------------------------------------------
// Adapter Observable-first para callables autoritativas. O navegador não grava
// propriedade, status da Comunidade, memberships ou auditoria diretamente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, tap } from 'rxjs';

import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import {
  CommunityArchiveResponse,
  CommunityOwnershipCandidatesResponse,
  CommunityOwnershipInboxResponse,
  CommunityOwnershipTransferActionResponse,
  CommunityOwnershipTransferResponse,
  normalizeCommunityArchiveResponse,
  normalizeCommunityOwnershipCandidatesResponse,
  normalizeCommunityOwnershipInboxResponse,
  normalizeCommunityOwnershipTransferActionResponse,
  normalizeCommunityOwnershipTransferResponse,
} from './community-ownership.model';

@Injectable({ providedIn: 'root' })
export class CommunityOwnershipRepository {
  private readonly functions = inject(Functions);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);

  private readonly getCandidatesCallable = httpsCallable<
    { communityId: string; cursor: string | null },
    unknown
  >(this.functions, 'getCommunityOwnershipCandidatesPage');

  private readonly transferOwnershipCallable = httpsCallable<
    { communityId: string; targetUid: string; requestId: string },
    unknown
  >(this.functions, 'transferCommunityOwnership');

  private readonly archiveCommunityCallable = httpsCallable<
    { communityId: string; requestId: string; reason: string | null },
    unknown
  >(this.functions, 'archiveCommunity');

  private readonly getOwnershipTransfersCallable = httpsCallable<
    Record<string, never>,
    unknown
  >(this.functions, 'getMyCommunityOwnershipTransfers');

  private readonly respondOwnershipTransferCallable = httpsCallable<
    { requestId: string; action: 'accept' | 'decline' },
    unknown
  >(this.functions, 'respondCommunityOwnershipTransfer');

  private readonly cancelOwnershipTransferCallable = httpsCallable<
    { requestId: string },
    unknown
  >(this.functions, 'cancelCommunityOwnershipTransfer');

  getCandidates$(
    communityId: string,
    cursor: string | null = null
  ): Observable<CommunityOwnershipCandidatesResponse> {
    return defer(() =>
      from(
        this.getCandidatesCallable({
          communityId: communityId.trim(),
          cursor: cursor?.trim() || null,
        })
      )
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
    const requestId = this.createRequestId('transfer');
    const normalizedCommunityId = communityId.trim();

    return defer(() =>
      from(
        this.transferOwnershipCallable({
          communityId: normalizedCommunityId,
          targetUid: targetUid.trim(),
          requestId,
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

  getOwnershipTransfers$(): Observable<CommunityOwnershipInboxResponse> {
    return defer(() => from(this.getOwnershipTransfersCallable({}))).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnershipInboxResponse(result.data);

        if (!normalized) {
          throw new Error('Caixa de transferências de propriedade inválida.');
        }

        return normalized;
      })
    );
  }

  respondOwnershipTransfer$(
    requestId: string,
    action: 'accept' | 'decline'
  ): Observable<CommunityOwnershipTransferActionResponse> {
    return defer(() =>
      from(this.respondOwnershipTransferCallable({
        requestId: requestId.trim(),
        action,
      }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnershipTransferActionResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Resposta da transferência de propriedade inválida.');
        }

        return normalized;
      }),
      tap((result) => {
        if (result.status !== 'completed') return;
        this.discoveryCache.invalidateCurrentViewer({
          sourceType: 'community',
          communityId: result.communityId,
        });
      })
    );
  }

  cancelOwnershipTransfer$(
    requestId: string
  ): Observable<CommunityOwnershipTransferActionResponse> {
    return defer(() =>
      from(this.cancelOwnershipTransferCallable({
        requestId: requestId.trim(),
      }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnershipTransferActionResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Resposta de cancelamento da transferência inválida.');
        }

        return normalized;
      })
    );
  }

  archiveCommunity$(
    communityId: string,
    reason?: string | null
  ): Observable<CommunityArchiveResponse> {
    const requestId = this.createRequestId('archive');
    const normalizedCommunityId = communityId.trim();
    const safeReason = this.normalizeOptionalReason(reason);

    return defer(() =>
      from(
        this.archiveCommunityCallable({
          communityId: normalizedCommunityId,
          requestId,
          reason: safeReason,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityArchiveResponse(result.data);

        if (!normalized) {
          throw new Error('Resposta de arquivamento da Comunidade inválida.');
        }

        return normalized;
      }),
      tap(() => this.discoveryCache.invalidateCurrentViewer({
        sourceType: 'community',
        communityId: normalizedCommunityId,
      }))
    );
  }

  private normalizeOptionalReason(reason?: string | null): string | null {
    const normalized = String(reason ?? '')
      .replace(/\p{Cc}/gu, ' ')
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
    const fallbackEntropy = entropy
      || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

    return `${prefix}:${fallbackEntropy}`.slice(0, 128);
  }
}
