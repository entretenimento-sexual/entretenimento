import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  normalizePrivateMediaDraftOperationError,
} from './private-media-draft-operation-error';

export type PrivateMediaDraftKind = 'photo' | 'video';
export type PrivateMediaDraftPlan = 'free' | 'basic' | 'premium' | 'vip';
export type PrivateMediaUploadOperation = 'CREATE' | 'REPLACE';
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

export interface PrivateMediaUploadReservationCommand {
  ownerUid: string;
  mediaId: string;
  kind: PrivateMediaDraftKind;
  operation: PrivateMediaUploadOperation;
  sourceStoragePath: string;
  auxiliaryStoragePath?: string | null;
  currentStoragePath?: string | null;
  sourceSizeBytes: number;
  auxiliarySizeBytes?: number;
  clientRequestId?: string;
}

interface ReservePrivateMediaUploadRequest {
  clientRequestId: string;
  ownerUid: string;
  mediaId: string;
  kind: PrivateMediaDraftKind;
  operation: PrivateMediaUploadOperation;
  sourceStoragePath: string;
  auxiliaryStoragePath: string | null;
  currentStoragePath: string | null;
  sourceSizeBytes: number;
  auxiliarySizeBytes: number;
}

export interface PrivateMediaUploadReservation {
  reservationId: string;
  mediaId: string;
  kind: PrivateMediaDraftKind;
  operation: PrivateMediaUploadOperation;
  plan: PrivateMediaDraftPlan;
  expiresAt: number;
  draftExpiresAt: number | null;
  reservedBytes: number;
}

interface CancelPrivateMediaUploadRequest {
  reservationId: string;
}

interface CancelPrivateMediaUploadResponse {
  reservationId: string;
  released: boolean;
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
  private readonly reserveCallable = httpsCallable<
    ReservePrivateMediaUploadRequest,
    PrivateMediaUploadReservation
  >(this.functions, 'reservePrivateMediaUpload');
  private readonly cancelCallable = httpsCallable<
    CancelPrivateMediaUploadRequest,
    CancelPrivateMediaUploadResponse
  >(this.functions, 'cancelPrivateMediaUploadReservation');

  checkCapacity$(
    kind: PrivateMediaDraftKind,
    sourceSizeBytes: number,
    auxiliarySizeBytes = 0
  ): Observable<PrivateMediaDraftCapacityResponse> {
    const request = this.normalizeCapacityRequest(
      kind,
      sourceSizeBytes,
      auxiliarySizeBytes
    );

    return defer(() => from(this.capacityCallable(request))).pipe(
      map((response) => this.normalizeCapacityResponse(response.data)),
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
          return of(decision);
        }

        return throwError(() => new PrivateMediaDraftCapacityError(
          decision,
          this.buildDeniedMessage(kind, decision)
        ));
      })
    );
  }

  reserveUpload$(
    command: PrivateMediaUploadReservationCommand
  ): Observable<PrivateMediaUploadReservation> {
    const request = this.normalizeReservationRequest(command);

    return defer(() => from(this.reserveCallable(request))).pipe(
      map((response) => this.normalizeReservation(response.data)),
      catchError((error) => {
        const normalizedError = normalizePrivateMediaDraftOperationError(
          error,
          'Não foi possível reservar espaço para o envio.'
        );

        this.reportError(normalizedError, {
          op: 'reserveUpload$',
          kind: request.kind,
          operation: request.operation,
          hasOwnerUid: !!request.ownerUid,
          hasMediaId: !!request.mediaId,
          sourceSizeBytes: request.sourceSizeBytes,
          auxiliarySizeBytes: request.auxiliarySizeBytes,
        });
        return throwError(() => normalizedError);
      })
    );
  }

  cancelUploadReservation$(reservationId: string): Observable<boolean> {
    const safeReservationId = String(reservationId ?? '').trim();

    if (!safeReservationId) {
      return of(false);
    }

    return defer(() => from(this.cancelCallable({
      reservationId: safeReservationId,
    }))).pipe(
      map((response) => response.data.released === true),
      catchError((error) => {
        this.reportError(error, {
          op: 'cancelUploadReservation$',
          hasReservationId: true,
        });
        return of(false);
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

  private normalizeCapacityRequest(
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

  private normalizeReservationRequest(
    command: PrivateMediaUploadReservationCommand
  ): ReservePrivateMediaUploadRequest {
    const ownerUid = String(command.ownerUid ?? '').trim();
    const mediaId = String(command.mediaId ?? '').trim();
    const sourceStoragePath = String(command.sourceStoragePath ?? '').trim();
    const auxiliaryStoragePath = String(
      command.auxiliaryStoragePath ?? ''
    ).trim() || null;
    const currentStoragePath = String(
      command.currentStoragePath ?? ''
    ).trim() || null;
    const sourceSizeBytes = this.normalizePositiveInteger(
      command.sourceSizeBytes
    );
    const auxiliarySizeBytes = this.normalizeNonNegativeInteger(
      command.auxiliarySizeBytes
    );

    if (!ownerUid || !mediaId || !sourceStoragePath || !sourceSizeBytes) {
      throw new Error('Os dados da reserva de upload estão incompletos.');
    }

    if (
      command.operation === 'REPLACE' &&
      (!currentStoragePath || command.kind !== 'photo')
    ) {
      throw new Error('A substituição precisa da foto privada atual.');
    }

    return {
      clientRequestId: String(command.clientRequestId ?? '').trim() ||
        this.randomId(),
      ownerUid,
      mediaId,
      kind: command.kind,
      operation: command.operation,
      sourceStoragePath,
      auxiliaryStoragePath,
      currentStoragePath,
      sourceSizeBytes,
      auxiliarySizeBytes,
    };
  }

  private normalizeCapacityResponse(
    value: PrivateMediaDraftCapacityResponse
  ): PrivateMediaDraftCapacityResponse {
    const reason = value?.reason === 'ITEM_LIMIT' ||
      value?.reason === 'BYTE_LIMIT'
      ? value.reason
      : 'ALLOWED';
    const plan = this.normalizePlan(value?.plan);

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

  private normalizeReservation(
    value: PrivateMediaUploadReservation
  ): PrivateMediaUploadReservation {
    const reservationId = String(value?.reservationId ?? '').trim();
    const mediaId = String(value?.mediaId ?? '').trim();

    if (!reservationId || !mediaId) {
      throw new Error('O backend retornou uma reserva de upload inválida.');
    }

    return {
      reservationId,
      mediaId,
      kind: value.kind === 'video' ? 'video' : 'photo',
      operation: value.operation === 'REPLACE' ? 'REPLACE' : 'CREATE',
      plan: this.normalizePlan(value.plan),
      expiresAt: this.normalizePositiveInteger(value.expiresAt),
      draftExpiresAt: value.draftExpiresAt === null
        ? null
        : this.normalizePositiveInteger(value.draftExpiresAt),
      reservedBytes: this.normalizePositiveInteger(value.reservedBytes),
    };
  }

  private normalizePlan(value: unknown): PrivateMediaDraftPlan {
    return value === 'basic' || value === 'premium' || value === 'vip'
      ? value
      : 'free';
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

  private randomId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao controlar a capacidade de rascunhos.');

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
