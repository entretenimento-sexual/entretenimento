import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export type PrivateMediaDraftKind = 'photo' | 'video';
export type PrivateMediaDraftPlan = 'free' | 'basic' | 'premium' | 'vip';
export type PrivateMediaDraftCapacityReason =
  | 'ALLOWED'
  | 'ITEM_LIMIT'
  | 'BYTE_LIMIT';

interface PrivateMediaDraftCapacityRequest {
  kind: PrivateMediaDraftKind;
  sourceSizeBytes: number;
  auxiliarySizeBytes: number;
}

export interface PrivateMediaDraftCapacityResponse {
  allowed: boolean;
  reason: PrivateMediaDraftCapacityReason;
  plan: PrivateMediaDraftPlan;
  expiresAfterMs: number;
  currentItems: number;
  currentReservedBytes: number;
  maxItems: number;
  maxReservedBytes: number;
  requestedReservedBytes: number;
}

export class PrivateMediaDraftCapacityError extends Error {
  readonly code = 'media/private-draft-capacity-exceeded';

  constructor(
    readonly decision: PrivateMediaDraftCapacityResponse,
    message: string
  ) {
    super(message);
    this.name = 'PrivateMediaDraftCapacityError';
  }
}

@Injectable({ providedIn: 'root' })
export class PrivateMediaDraftCapacityService {
  private readonly functions = inject(Functions);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly capacityCallable = httpsCallable<
    PrivateMediaDraftCapacityRequest,
    PrivateMediaDraftCapacityResponse
  >(this.functions, 'getPrivateMediaDraftCapacity');

  checkCapacity$(
    kind: PrivateMediaDraftKind,
    sourceSizeBytes: number,
    auxiliarySizeBytes = 0
  ): Observable<PrivateMediaDraftCapacityResponse> {
    const request = this.normalizeRequest(
      kind,
      sourceSizeBytes,
      auxiliarySizeBytes
    );

    return defer(() => from(this.capacityCallable(request))).pipe(
      map((response) => this.normalizeResponse(response.data)),
      catchError((error) => {
        this.reportError(error, {
          op: 'checkCapacity$',
          kind,
          sourceSizeBytes: request.sourceSizeBytes,
          auxiliarySizeBytes: request.auxiliarySizeBytes,
        });
        return throwError(() => error);
      })
    );
  }

  assertCapacity$(
    kind: PrivateMediaDraftKind,
    sourceSizeBytes: number,
    auxiliarySizeBytes = 0
  ): Observable<PrivateMediaDraftCapacityResponse> {
    return this.checkCapacity$(
      kind,
      sourceSizeBytes,
      auxiliarySizeBytes
    ).pipe(
      switchMap((decision) => {
        if (decision.allowed) {
          return from([decision]);
        }

        return throwError(() => new PrivateMediaDraftCapacityError(
          decision,
          this.buildDeniedMessage(kind, decision)
        ));
      })
    );
  }

  formatRetention(expiresAfterMs: number): string {
    const normalized = Math.max(0, Math.trunc(Number(expiresAfterMs ?? 0)));
    const days = Math.round(normalized / (24 * 60 * 60 * 1000));

    if (days >= 1) {
      return days === 1 ? '1 dia' : `${days} dias`;
    }

    const hours = Math.max(1, Math.round(normalized / (60 * 60 * 1000)));
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }

  private normalizeRequest(
    kind: PrivateMediaDraftKind,
    sourceSizeBytes: number,
    auxiliarySizeBytes: number
  ): PrivateMediaDraftCapacityRequest {
    const normalizedSourceSize = this.normalizePositiveInteger(
      sourceSizeBytes
    );
    const normalizedAuxiliarySize = this.normalizeNonNegativeInteger(
      auxiliarySizeBytes
    );

    if (!normalizedSourceSize) {
      throw new Error('O arquivo precisa ter um tamanho válido antes do envio.');
    }

    return {
      kind,
      sourceSizeBytes: normalizedSourceSize,
      auxiliarySizeBytes: normalizedAuxiliarySize,
    };
  }

  private normalizeResponse(
    value: PrivateMediaDraftCapacityResponse
  ): PrivateMediaDraftCapacityResponse {
    const reason = value?.reason === 'ITEM_LIMIT' ||
      value?.reason === 'BYTE_LIMIT'
      ? value.reason
      : 'ALLOWED';
    const plan = value?.plan === 'basic' ||
      value?.plan === 'premium' ||
      value?.plan === 'vip'
      ? value.plan
      : 'free';

    return {
      allowed: value?.allowed === true && reason === 'ALLOWED',
      reason,
      plan,
      expiresAfterMs: this.normalizeNonNegativeInteger(
        value?.expiresAfterMs
      ),
      currentItems: this.normalizeNonNegativeInteger(value?.currentItems),
      currentReservedBytes: this.normalizeNonNegativeInteger(
        value?.currentReservedBytes
      ),
      maxItems: this.normalizeNonNegativeInteger(value?.maxItems),
      maxReservedBytes: this.normalizeNonNegativeInteger(
        value?.maxReservedBytes
      ),
      requestedReservedBytes: this.normalizeNonNegativeInteger(
        value?.requestedReservedBytes
      ),
    };
  }

  private buildDeniedMessage(
    kind: PrivateMediaDraftKind,
    decision: PrivateMediaDraftCapacityResponse
  ): string {
    const mediaLabel = kind === 'photo' ? 'fotos' : 'vídeos';

    if (decision.reason === 'ITEM_LIMIT') {
      return `Você atingiu o limite de rascunhos de ${mediaLabel}. Publique ou exclua um rascunho antes de enviar outro.`;
    }

    return `Seus rascunhos de ${mediaLabel} atingiram o limite de armazenamento temporário. Publique ou exclua conteúdo antes de continuar.`;
  }

  private normalizePositiveInteger(value: unknown): number {
    const normalized = this.normalizeNonNegativeInteger(value);
    return normalized > 0 ? normalized : 0;
  }

  private normalizeNonNegativeInteger(value: unknown): number {
    const numberValue = Number(value ?? 0);

    if (!Number.isFinite(numberValue) || numberValue <= 0) {
      return 0;
    }

    return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(numberValue));
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao consultar a capacidade de rascunhos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PrivateMediaDraftCapacityService',
        ...context,
      };
      (normalized as any).silent = true;
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // A falha de telemetria não deve substituir o erro original.
    }
  }
}
