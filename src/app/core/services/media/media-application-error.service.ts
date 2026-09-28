import { Injectable, inject } from '@angular/core';

import {
  ApplicationErrorDescriptor,
  ApplicationErrorService,
} from 'src/app/core/services/error-handler/application-error.service';
import {
  MEDIA_ERROR_CODE_MESSAGES,
  MEDIA_ERROR_CODE_PRESENTATIONS,
  MEDIA_ERROR_MESSAGES,
  MEDIA_ERROR_PRESENTATIONS,
  type MediaErrorReason,
  resolveMediaErrorMessage,
  resolveMediaErrorPresentation,
} from './media-error.catalog';

type UnknownRecord = Record<string, unknown>;

export interface MediaApplicationErrorOptions {
  readonly operation: string;
  readonly fallbackMessage?: string;
  readonly reasonHint?: MediaErrorReason;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly silent?: boolean;
}

/**
 * Fronteira canônica de erros do domínio de mídia.
 *
 * Topologia:
 * mídia -> ApplicationErrorService -> ErrorNotificationService
 *                                -> GlobalErrorHandlerService
 *
 * Serviços/componentes de mídia não devem chamar GlobalErrorHandlerService
 * diretamente. Avisos de validação, sucesso e informação continuam podendo
 * usar ErrorNotificationService sem transformar estados esperados em exceção.
 */
@Injectable({ providedIn: 'root' })
export class MediaApplicationErrorService {
  private readonly applicationError = inject(ApplicationErrorService);

  report(
    error: unknown,
    options: MediaApplicationErrorOptions
  ): ApplicationErrorDescriptor {
    const actualReason = this.extractReason(error);
    const transportCode = this.extractTransportCode(error);
    const hasKnownReason = !!(
      actualReason && resolveMediaErrorMessage(actualReason)
    );
    const catalogReason = hasKnownReason
      ? actualReason
      : options.reasonHint ?? null;
    const hasKnownCodePresentation = !!(
      transportCode && MEDIA_ERROR_CODE_PRESENTATIONS[transportCode]
    );
    const fallbackMessage = resolveMediaErrorMessage(catalogReason)
      ?? this.safeText(
        options.fallbackMessage,
        'Não foi possível concluir a operação de mídia.'
      );
    const catalogPresentation = resolveMediaErrorPresentation(catalogReason);

    return this.applicationError.report(error, {
      feature: 'media',
      operation: this.safeText(options.operation, 'unknown'),
      fallbackMessage,
      presentation: options.silent
        ? { surface: 'none', severity: 'error' }
        : hasKnownReason || hasKnownCodePresentation
          ? undefined
          : catalogPresentation ?? undefined,
      codeMessages: MEDIA_ERROR_CODE_MESSAGES,
      codePresentations: MEDIA_ERROR_CODE_PRESENTATIONS,
      reasonMessages: MEDIA_ERROR_MESSAGES,
      reasonPresentations: MEDIA_ERROR_PRESENTATIONS,
      metadata: {
        ...(options.metadata ?? {}),
        ...(catalogReason ? { mediaErrorReason: catalogReason } : {}),
      },
    });
  }

  reportSilently(
    error: unknown,
    operation: string,
    fallbackMessage?: string,
    metadata?: Readonly<Record<string, unknown>>,
    reasonHint?: MediaErrorReason
  ): ApplicationErrorDescriptor {
    return this.report(error, {
      operation,
      fallbackMessage,
      reasonHint,
      metadata,
      silent: true,
    });
  }

  private extractReason(error: unknown): string | null {
    const source = this.asRecord(error);
    const details = this.asRecord(source?.['details']);

    return this.safeOptionalText(
      details?.['reason'] ?? source?.['reason']
    );
  }

  private extractTransportCode(error: unknown): string | null {
    const source = this.asRecord(error);
    const code = this.safeOptionalText(source?.['code']);
    if (!code) return null;

    return code
      .replace(/^functions\//, '')
      .replace(/^firestore\//, '');
  }

  private asRecord(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as UnknownRecord
      : null;
  }

  private safeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, 280) : null;
  }

  private safeText(value: unknown, fallback: string): string {
    return this.safeOptionalText(value) ?? fallback;
  }
}
