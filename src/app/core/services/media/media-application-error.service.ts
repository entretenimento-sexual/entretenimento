import { Injectable, inject } from '@angular/core';

import {
  ApplicationErrorDescriptor,
  ApplicationErrorService,
} from 'src/app/core/services/error-handler/application-error.service';

type UnknownRecord = Record<string, unknown>;

export interface MediaApplicationErrorOptions {
  readonly operation: string;
  readonly fallbackMessage: string;
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
    const fallbackMessage = this.safeText(
      options.fallbackMessage,
      'Não foi possível concluir a operação de mídia.'
    );
    const override = this.messageOverride(error, fallbackMessage);

    return this.applicationError.report(error, {
      feature: 'media',
      operation: this.safeText(options.operation, 'unknown'),
      fallbackMessage,
      presentation: options.silent
        ? { surface: 'none', severity: 'error' }
        : undefined,
      codeMessages: override.codeMessages,
      reasonMessages: override.reasonMessages,
      recommendedActionMessages: override.recommendedActionMessages,
      metadata: options.metadata,
    });
  }

  reportSilently(
    error: unknown,
    operation: string,
    fallbackMessage: string,
    metadata?: Readonly<Record<string, unknown>>
  ): ApplicationErrorDescriptor {
    return this.report(error, {
      operation,
      fallbackMessage,
      metadata,
      silent: true,
    });
  }

  /**
   * Aceita erros já enriquecidos por fluxos legados durante a migração.
   * A apresentação e o diagnóstico passam a pertencer ao ApplicationErrorService.
   */
  handleError(error: unknown): ApplicationErrorDescriptor {
    const source = this.asRecord(error);
    const context = this.asRecord(source?.['context']) ?? {};
    const original = source?.['original'] ?? error;
    const operation = this.safeText(context['op'], 'unknown');
    const fallbackMessage = this.safeText(
      source?.['userFacingMessage'],
      'Não foi possível concluir a operação de mídia.'
    );

    return this.report(original, {
      operation,
      fallbackMessage,
      metadata: context,
      silent: source?.['skipUserNotification'] === true,
    });
  }

  private messageOverride(
    error: unknown,
    message: string
  ): {
    codeMessages?: Readonly<Record<string, string>>;
    reasonMessages?: Readonly<Record<string, string>>;
    recommendedActionMessages?: Readonly<Record<string, string>>;
  } {
    const source = this.asRecord(error);
    const details = this.asRecord(source?.['details']);
    const code = this.normalizeCode(source?.['code']);
    const reason = this.safeOptionalText(
      details?.['reason'] ?? source?.['reason']
    );
    const recommendedAction = this.safeOptionalText(
      details?.['recommendedAction'] ?? source?.['recommendedAction']
    );

    return {
      codeMessages: code ? { [code]: message } : undefined,
      reasonMessages: reason ? { [reason]: message } : undefined,
      recommendedActionMessages: recommendedAction
        ? { [recommendedAction]: message }
        : undefined,
    };
  }

  private normalizeCode(value: unknown): string | null {
    const code = this.safeOptionalText(value);

    return code
      ?.replace(/^functions\//, '')
      .replace(/^firestore\//, '') ?? null;
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
