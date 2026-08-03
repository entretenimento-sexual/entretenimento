import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable } from 'rxjs';

import {
  IPublicVideoRankingCursor,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';

export interface IPublicVideoRankingRawDocument {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

export interface IPublicVideoRankingRawPage {
  readonly documents: readonly IPublicVideoRankingRawDocument[];
  readonly nextCursor: IPublicVideoRankingCursor | null;
  readonly hasMore: boolean;
}

export interface IPublicVideoRankingGatewayRequest {
  readonly mode: TPublicVideoRankingMode;
  readonly pageSize: number;
  readonly cursor: IPublicVideoRankingCursor | null;
}

/**
 * O nome da classe é mantido para preservar injeções e consumidores existentes.
 * A leitura global direta do Firestore foi suprimida porque Rules não filtram
 * bloqueios bilaterais. O contrato reativo agora usa a callable autorizada.
 */
@Injectable({ providedIn: 'root' })
export class PublicVideoRankingFirestoreGateway {
  private readonly functions = inject(Functions);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly listAuthorizedPublicVideosCallable = httpsCallable<
    IPublicVideoRankingGatewayRequest,
    IPublicVideoRankingRawPage
  >(this.functions, 'listAuthorizedPublicVideos');

  loadPage$(
    request: IPublicVideoRankingGatewayRequest
  ): Observable<IPublicVideoRankingRawPage> {
    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.listAuthorizedPublicVideosCallable(request);
      return this.normalizePage(response.data, request.mode);
    });
  }

  private normalizePage(
    candidate: IPublicVideoRankingRawPage,
    mode: TPublicVideoRankingMode
  ): IPublicVideoRankingRawPage {
    const documents = Array.isArray(candidate?.documents)
      ? candidate.documents.flatMap((document) => {
        const id = String(document?.id ?? '').trim();
        const path = String(document?.path ?? '').trim();
        const data = document?.data;

        if (
          !id ||
          !path ||
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data)
        ) {
          return [];
        }

        return [{
          id,
          path,
          data: data as Record<string, unknown>,
        }];
      })
      : [];
    const cursor = candidate?.nextCursor;
    const nextCursor = cursor?.mode === mode
      ? cursor
      : null;

    return {
      documents,
      nextCursor,
      hasMore: candidate?.hasMore === true && nextCursor !== null,
    };
  }
}
