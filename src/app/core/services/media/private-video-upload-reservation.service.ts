import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

export type PrivateVideoQuotaPlan = 'free' | 'basic' | 'premium' | 'vip';

export interface ReservePrivateVideoUploadCommand {
  readonly clientRequestId: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly videoStoragePath: string;
  readonly posterStoragePath: string | null;
  readonly videoSizeBytes: number;
  readonly posterSizeBytes: number;
  readonly sourceDurationMs: number;
  readonly mimeType: string;
}

export interface PrivateVideoUploadCapacity {
  readonly plan: PrivateVideoQuotaPlan;
  readonly currentItems: number;
  readonly maxItems: number;
  readonly remainingItems: number;
  readonly currentReservedBytes: number;
  readonly maxReservedBytes: number;
  readonly remainingReservedBytes: number;
  readonly maxSourceBytes: number;
  readonly maxPosterBytes: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
  readonly itemLimitReached: boolean;
  readonly byteLimitReached: boolean;
  readonly canStartUpload: boolean;
  readonly calculatedAt: number;
}

export interface PrivateVideoUploadReservation {
  readonly reservationId: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly plan: PrivateVideoQuotaPlan;
  readonly expiresAt: number;
  readonly reservedBytes: number;
  readonly maxItems: number;
  readonly maxReservedBytes: number;
  readonly currentItems: number;
  readonly currentReservedBytes: number;
}

interface CancelPrivateVideoUploadReservationResponse {
  reservationId: string;
  released: boolean;
}

@Injectable({ providedIn: 'root' })
export class PrivateVideoUploadReservationService {
  private readonly functions = inject(Functions);

  private readonly capacityCallable = httpsCallable<
    Record<string, never>,
    PrivateVideoUploadCapacity
  >(this.functions, 'getPrivateVideoUploadCapacity');

  private readonly reserveCallable = httpsCallable<
    ReservePrivateVideoUploadCommand,
    PrivateVideoUploadReservation
  >(this.functions, 'reservePrivateVideoUpload');

  private readonly cancelCallable = httpsCallable<
    { reservationId: string },
    CancelPrivateVideoUploadReservationResponse
  >(this.functions, 'cancelPrivateVideoUploadReservation');

  getCapacity$(): Observable<PrivateVideoUploadCapacity> {
    return from(this.capacityCallable({})).pipe(
      map((response) => response.data)
    );
  }

  reserveUpload$(
    command: ReservePrivateVideoUploadCommand
  ): Observable<PrivateVideoUploadReservation> {
    return from(this.reserveCallable(command)).pipe(
      map((response) => response.data)
    );
  }

  cancelReservation$(reservationId: string): Observable<boolean> {
    return from(this.cancelCallable({ reservationId })).pipe(
      map((response) => response.data.released === true)
    );
  }
}
