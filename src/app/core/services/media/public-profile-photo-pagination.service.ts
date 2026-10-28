import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import {
  PublicMediaReadBoundaryService,
  PublicMediaReadCursor,
} from './public-media-read-boundary.service';

export interface IPublicProfilePhotoCursor {
  readonly documentId: string;
  readonly orderIndex: number;
  readonly publishedAt: number;
}

export interface IPublicProfilePhotoPage {
  readonly items: readonly IPublicPhotoItem[];
  readonly nextCursor: IPublicProfilePhotoCursor | null;
  readonly hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 24;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * POLITICA DE PRODUTO - MEDIA V1
 *
 * A plataforma destina-se a adultos. Nudez adulta e sexo explicito
 * consensual sao conteudos permitidos e esperados neste produto.
 * Nao sao infracoes por si mesmos.
 *
 * MODERACAO:
 * - A moderacao inicial e reativa, baseada em denuncias dos usuarios.
 * - Denuncias sinalizam possiveis violacoes; decisoes de moderacao
 *   seguem a autoridade administrativa e os fluxos existentes.
 * - Nao exigir revisao humana previa indiscriminada de cada foto.
 * - Nao presumir que existe moderacao automatica por IA ativa.
 *
 * EVOLUCOES FUTURAS, AINDA NAO APROVADAS PARA IMPLEMENTACAO:
 * - IA para identificar possiveis conteudos criminosos.
 * - Deteccao de rostos para eventual borramento de identidade.
 * - Ambas exigem analise de privacidade, custo e decisao explicita.
 *
 * GARANTIAS QUE PERMANECEM OBRIGATORIAS:
 * - Validacao tecnica do arquivo e autorizacao de publicacao.
 * - Protecao contra conteudos envolvendo menores, violencia
 *   sexual, ausencia de consentimento e demais ilegalidades.
 * - Denuncias, retirada publica e limpeza de ativos conforme
 *   as regras canonicas de lifecycle.
 * - Nenhuma galeria privada gratuita para armazenar fotos.
 *
 * O filtro moderationStatus === 'APPROVED' e um requisito de
 * elegibilidade para exibicao publica. Ele nao deve ser
 * interpretado como proibicao de nudez adulta ou como prova
 * de revisao previa humana ou automatica.
 *
 * Este comentario documenta a politica de produto; nao altera
 * sozinho as garantias efetivamente implementadas no backend.
 */
@Injectable({ providedIn: 'root' })
export class PublicProfilePhotoPaginationService {
  private readonly read = inject(PublicMediaReadBoundaryService);
  private readonly access = inject(PublicPhotoAccessService);
  private readonly mediaError = inject(MediaApplicationErrorService);

  loadPage$(
    ownerUid: string,
    options: {
      readonly pageSize?: number;
      readonly cursor?: IPublicProfilePhotoCursor | null;
    } = {}
  ): Observable<IPublicProfilePhotoPage> {
    const owner = String(ownerUid ?? '').trim();
    const size = this.normalizePageSize(options.pageSize);
    const cursor = this.normalizeCursor(options.cursor);

    if (!SAFE_ID.test(owner)) {
      return of({
        items: [],
        nextCursor: null,
        hasMore: false,
      });
    }

    return this.read.read$({
      mediaType: 'PHOTO',
      mode: 'PROFILE',
      ownerUids: [owner],
      limit: size,
      cursor: cursor
        ? {
            documentPath:
              `public_profiles/${owner}/public_photos/${cursor.documentId}`,
            orderIndex: cursor.orderIndex,
            publishedAt: cursor.publishedAt,
          }
        : null,
    }).pipe(
      switchMap((response) => {
        const projections = (response.items ?? []).flatMap((item) => {
          const candidate = item as Partial<IPublicPhotoProjection>;
          const id = String(candidate.id ?? '').trim();

          if (
            candidate.ownerUid !== owner ||
            !SAFE_ID.test(id) ||
            candidate.visibility !== 'PUBLIC' ||
            candidate.moderationStatus !== 'APPROVED'
          ) {
            return [];
          }

          return [candidate as IPublicPhotoProjection];
        });

        const nextCursor = this.fromBackendCursor(
          response.nextCursor,
          response.hasMore,
          owner
        );

        return this.access.hydratePublicPhotoUrls$(projections).pipe(
          map((items): IPublicProfilePhotoPage => ({
            items,
            nextCursor,
            hasMore: nextCursor !== null,
          }))
        );
      }),
      catchError((error: unknown) => {
        this.mediaError.reportSilently(
          error,
          'loadPublicProfilePhotoPage',
          'Falha ao carregar a pagina de fotos publicas.',
          {
            scope: 'PublicProfilePhotoPaginationService',
            hasOwnerUid: true,
            pageSize: size,
            hasCursor: !!cursor,
          },
          'media_discovery_page_failed'
        );

        return throwError(() => error);
      })
    );
  }

  private fromBackendCursor(
    cursor: PublicMediaReadCursor | null,
    hasMore: boolean,
    owner: string
  ): IPublicProfilePhotoCursor | null {
    if (!hasMore || !cursor) {
      return null;
    }

    const path = String(cursor.documentPath ?? '').trim();
    const prefix = `public_profiles/${owner}/public_photos/`;

    if (!path.startsWith(prefix)) {
      return null;
    }

    const documentId = path.slice(prefix.length);
    const orderIndex = Number(cursor.orderIndex);
    const publishedAt = Number(cursor.publishedAt);

    if (
      !SAFE_ID.test(documentId) ||
      !Number.isFinite(orderIndex) ||
      orderIndex < 0 ||
      !Number.isFinite(publishedAt) ||
      publishedAt < 0
    ) {
      return null;
    }

    return { documentId, orderIndex, publishedAt };
  }

  private normalizeCursor(
    cursor: IPublicProfilePhotoCursor | null | undefined
  ): IPublicProfilePhotoCursor | null {
    if (!cursor || !SAFE_ID.test(String(cursor.documentId ?? ''))) {
      return null;
    }

    const orderIndex = Number(cursor.orderIndex);
    const publishedAt = Number(cursor.publishedAt);

    if (
      !Number.isFinite(orderIndex) ||
      orderIndex < 0 ||
      !Number.isFinite(publishedAt) ||
      publishedAt < 0
    ) {
      return null;
    }

    return {
      documentId: cursor.documentId,
      orderIndex,
      publishedAt,
    };
  }

  private normalizePageSize(value: unknown): number {
    const parsed = Number(value ?? DEFAULT_PAGE_SIZE);

    if (!Number.isFinite(parsed)) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(parsed)));
  }
}