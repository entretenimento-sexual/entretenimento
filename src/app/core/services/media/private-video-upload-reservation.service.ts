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
  readonly mimeType: string;
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

  private readonly reserveCallable = httpsCallable<
    ReservePrivateVideoUploadCommand,
    PrivateVideoUploadReservation
  >(this.functions, 'reservePrivateVideoUpload');

  private readonly cancelCallable = httpsCallable<
    { reservationId: string },
    CancelPrivateVideoUploadReservationResponse
  >(this.functions, 'cancelPrivateVideoUploadReservation');

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
