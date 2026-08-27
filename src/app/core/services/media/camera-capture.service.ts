// src/app/core/services/media/camera-capture.service.ts
// -----------------------------------------------------------------------------
// CAMERA CAPTURE
// -----------------------------------------------------------------------------
// Captura explícita de foto pela câmera do dispositivo. A API é Observable-first
// e não mantém MediaStream global: quem abre a câmera continua responsável por
// encerrar as tracks quando a experiência termina.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import {
  Observable,
  catchError,
  defer,
  from,
  throwError,
} from 'rxjs';

export type CameraCaptureErrorCode =
  | 'UNSUPPORTED'
  | 'INSECURE_CONTEXT'
  | 'PERMISSION_DENIED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_BUSY'
  | 'CONSTRAINT_FAILED'
  | 'CAPTURE_FAILED'
  | 'UNKNOWN';

export class CameraCaptureError extends Error {
  constructor(
    readonly code: CameraCaptureErrorCode,
    message: string,
    readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'CameraCaptureError';
  }
}

@Injectable({ providedIn: 'root' })
export class CameraCaptureService {
  isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function';
  }

  isSecureContext(): boolean {
    if (typeof globalThis === 'undefined') return false;
    if (globalThis.isSecureContext === true) return true;

    const hostname = globalThis.location?.hostname?.trim().toLowerCase() ?? '';
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]';
  }

  openCamera$(): Observable<MediaStream> {
    return defer(() => {
      if (!this.isSupported()) {
        return throwError(() => new CameraCaptureError(
          'UNSUPPORTED',
          'Este navegador não oferece acesso direto à câmera.'
        ));
      }

      if (!this.isSecureContext()) {
        return throwError(() => new CameraCaptureError(
          'INSECURE_CONTEXT',
          'A câmera só pode ser usada em uma conexão segura.'
        ));
      }

      return from(navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
        },
      })).pipe(
        catchError((error: unknown) =>
          throwError(() => this.normalizeError(error))
        )
      );
    });
  }

  captureFrame$(video: HTMLVideoElement): Observable<File> {
    return defer(() => {
      const width = Math.trunc(Number(video.videoWidth));
      const height = Math.trunc(Number(video.videoHeight));
      if (width <= 0 || height <= 0) {
        return throwError(() => new CameraCaptureError(
          'CAPTURE_FAILED',
          'A câmera ainda não está pronta para capturar a foto.'
        ));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        return throwError(() => new CameraCaptureError(
          'CAPTURE_FAILED',
          'Não foi possível preparar a captura da câmera.'
        ));
      }

      context.drawImage(video, 0, 0, width, height);
      return new Observable<File>((subscriber) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              subscriber.error(new CameraCaptureError(
                'CAPTURE_FAILED',
                'Não foi possível gerar a foto capturada.'
              ));
              return;
            }

            subscriber.next(new File(
              [blob],
              `camera-${Date.now()}.jpg`,
              {
                type: 'image/jpeg',
                lastModified: Date.now(),
              }
            ));
            subscriber.complete();
          },
          'image/jpeg',
          0.9
        );
      });
    });
  }

  stopStream(stream: MediaStream | null | undefined): void {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Encerramento best-effort; uma track já finalizada não bloqueia a UI.
      }
    }
  }

  private normalizeError(error: unknown): CameraCaptureError {
    if (error instanceof CameraCaptureError) return error;

    const name = error instanceof DOMException
      ? error.name
      : String((error as { name?: unknown } | null)?.name ?? '');

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return new CameraCaptureError(
        'PERMISSION_DENIED',
        'Permita o acesso à câmera para tirar uma foto.',
        error
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return new CameraCaptureError(
        'DEVICE_NOT_FOUND',
        'Nenhuma câmera disponível foi encontrada.',
        error
      );
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return new CameraCaptureError(
        'DEVICE_BUSY',
        'A câmera está sendo usada por outro aplicativo ou não pôde ser iniciada.',
        error
      );
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return new CameraCaptureError(
        'CONSTRAINT_FAILED',
        'A câmera disponível não atende à configuração solicitada.',
        error
      );
    }

    return new CameraCaptureError(
      'UNKNOWN',
      'Não foi possível abrir a câmera agora.',
      error
    );
  }
}
