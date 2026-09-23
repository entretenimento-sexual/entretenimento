// src/app/community/data-access/community-owner-succession-admin.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityOwnershipCandidatesResponse,
  normalizeCommunityOwnershipCandidatesResponse,
} from './community-ownership.model';
import {
  CommunityOwnerSuccessionAdminQueue,
  normalizeCommunityOwnerSuccessionAdminQueue,
} from './community-owner-succession-admin.model';

@Injectable({ providedIn: 'root' })
export class CommunityOwnerSuccessionAdminRepository {
  private readonly functions = inject(Functions);

  private readonly queueCallable = httpsCallable<void, unknown>(
    this.functions,
    'getCommunityOwnerSuccessionCases'
  );

  private readonly candidatesCallable = httpsCallable<
    { communityId: string; cursor: string | null },
    unknown
  >(this.functions, 'getCommunityOwnerSuccessionCandidatesPage');

  private readonly openCaseCallable = httpsCallable<
    {
      communityId: string;
      trigger: 'confirmed_abandonment';
      reason: string;
    },
    unknown
  >(this.functions, 'openCommunityOwnerTerminalSuccessionCase');

  private readonly nominateCallable = httpsCallable<
    { communityId: string; targetUid: string; requestId: string },
    unknown
  >(this.functions, 'nominateCommunityOwnerTerminalSuccessor');

  private readonly cancelCallable = httpsCallable<
    { communityId: string; reason: string },
    unknown
  >(this.functions, 'cancelCommunityOwnerTerminalSuccession');

  openConfirmedAbandonmentCase$(
    communityId: string,
    reason: string
  ): Observable<{
    communityId: string;
    status: 'open';
    deadlineAt: number;
  }> {
    const normalizedCommunityId = communityId.trim();
    const normalizedReason = reason.replace(/\s+/g, ' ').trim();

    return defer(() =>
      from(this.openCaseCallable({
        communityId: normalizedCommunityId,
        trigger: 'confirmed_abandonment',
        reason: normalizedReason,
      }))
    ).pipe(
      map((result) => {
        const source = (result.data ?? {}) as Record<string, unknown>;
        const returnedCommunityId = String(
          source['communityId'] ?? ''
        ).trim();
        const deadlineAt = Math.trunc(Number(source['deadlineAt']));

        if (
          returnedCommunityId !== normalizedCommunityId
          || source['status'] !== 'open'
          || !Number.isFinite(deadlineAt)
          || deadlineAt <= 0
        ) {
          throw new Error(
            'Resposta de abertura de sucessão por abandono inválida.'
          );
        }

        return {
          communityId: returnedCommunityId,
          status: 'open' as const,
          deadlineAt,
        };
      })
    );
  }

  getQueue$(): Observable<CommunityOwnerSuccessionAdminQueue> {
    return defer(() => from(this.queueCallable())).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnerSuccessionAdminQueue(
          result.data
        );
        if (!normalized) {
          throw new Error('Fila de sucessões de Comunidades inválida.');
        }
        return normalized;
      })
    );
  }

  getCandidates$(
    communityId: string,
    cursor: string | null = null
  ): Observable<CommunityOwnershipCandidatesResponse> {
    return defer(() =>
      from(this.candidatesCallable({
        communityId: communityId.trim(),
        cursor: cursor?.trim() || null,
      }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityOwnershipCandidatesResponse(
          result.data
        );
        if (!normalized) {
          throw new Error('Lista de candidatos à sucessão inválida.');
        }
        return normalized;
      })
    );
  }

  nominate$(
    communityId: string,
    targetUid: string
  ): Observable<{ requestId: string; expiresAt: number }> {
    const requestId = this.requestId();

    return defer(() =>
      from(this.nominateCallable({
        communityId: communityId.trim(),
        targetUid: targetUid.trim(),
        requestId,
      }))
    ).pipe(
      map((result) => {
        const source = (result.data ?? {}) as Record<string, unknown>;
        const returnedRequestId = String(source['requestId'] ?? '').trim();
        const expiresAt = Math.trunc(Number(source['expiresAt']));
        if (
          returnedRequestId !== requestId
          || !Number.isFinite(expiresAt)
          || expiresAt <= 0
        ) {
          throw new Error('Resposta de indicação de sucessor inválida.');
        }
        return { requestId: returnedRequestId, expiresAt };
      })
    );
  }

  cancelCase$(
    communityId: string
  ): Observable<{ communityId: string; status: 'canceled' }> {
    return defer(() =>
      from(this.cancelCallable({
        communityId: communityId.trim(),
        reason: 'Caso de sucessão terminal cancelado pela moderação.',
      }))
    ).pipe(
      map((result) => {
        const source = (result.data ?? {}) as Record<string, unknown>;
        const returnedCommunityId = String(
          source['communityId'] ?? ''
        ).trim();
        if (
          returnedCommunityId !== communityId.trim()
          || source['status'] !== 'canceled'
        ) {
          throw new Error('Resposta de cancelamento da sucessão inválida.');
        }
        return {
          communityId: returnedCommunityId,
          status: 'canceled' as const,
        };
      })
    );
  }

  private requestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `succession:${uuid}`;

    const bytes = new Uint32Array(4);
    globalThis.crypto?.getRandomValues?.(bytes);
    const entropy = Array.from(
      bytes,
      (value) => value.toString(36)
    ).join('');
    return (
      'succession:'
      + (entropy || Date.now().toString(36))
    ).slice(0, 128);
  }
}
