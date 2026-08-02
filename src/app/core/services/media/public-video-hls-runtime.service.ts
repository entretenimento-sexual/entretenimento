import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface HlsRuntimeErrorData {
  readonly fatal?: boolean;
  readonly type?: string;
  readonly details?: string;
  readonly response?: {
    readonly code?: number;
  };
}

export interface HlsRuntimeInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  startLoad(startPosition?: number): void;
  recoverMediaError(): void;
  destroy(): void;
  on(event: string, callback: (...args: any[]) => void): void;
}

export interface HlsRuntimeConstructor {
  new(config?: Record<string, unknown>): HlsRuntimeInstance;
  isSupported(): boolean;
  readonly Events: {
    readonly MEDIA_ATTACHED: string;
    readonly MANIFEST_PARSED: string;
    readonly ERROR: string;
  };
  readonly ErrorTypes: {
    readonly NETWORK_ERROR: string;
    readonly MEDIA_ERROR: string;
  };
}

declare global {
  interface Window {
    Hls?: HlsRuntimeConstructor;
  }
}

const HLS_RUNTIME_SCRIPT_ID = 'entretenimento-hls-runtime';
const HLS_RUNTIME_URL =
  'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.light.min.js';
const LOAD_TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class PublicVideoHlsRuntimeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private runtime$: Observable<HlsRuntimeConstructor | null> | null = null;

  constructor(
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  load$(): Observable<HlsRuntimeConstructor | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return of(null);
    }

    const available = this.resolveRuntime();

    if (available) {
      return of(available);
    }

    if (!this.runtime$) {
      this.runtime$ = defer(() => from(this.loadScript())).pipe(
        catchError((error: unknown) => {
          this.reportError(error);
          return of(null);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }

    return this.runtime$;
  }

  private resolveRuntime(): HlsRuntimeConstructor | null {
    const runtime = this.document.defaultView?.Hls;
    return runtime && typeof runtime.isSupported === 'function'
      ? runtime
      : null;
  }

  private loadScript(): Promise<HlsRuntimeConstructor | null> {
    return new Promise((resolve, reject) => {
      const existing = this.document.getElementById(
        HLS_RUNTIME_SCRIPT_ID
      ) as HTMLScriptElement | null;
      const script = existing ?? this.document.createElement('script');
      let settled = false;

      const finish = (
        callback: () => void
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
        callback();
      };
      const onLoad = (): void => finish(() => resolve(this.resolveRuntime()));
      const onError = (): void => finish(() => reject(
        new Error('Não foi possível carregar o runtime HLS.')
      ));
      const timeoutId = setTimeout(() => finish(() => reject(
        new Error('O carregamento do runtime HLS excedeu o tempo limite.')
      )), LOAD_TIMEOUT_MS);

      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });

      if (!existing) {
        script.id = HLS_RUNTIME_SCRIPT_ID;
        script.src = HLS_RUNTIME_URL;
        script.async = true;
        script.defer = true;
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        this.document.head.appendChild(script);
      }
    });
  }

  private reportError(error: unknown): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Falha ao carregar o player HLS.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PublicVideoHlsRuntimeService',
        runtimeVersion: '1.6.16',
      };
      (normalizedError as any).skipUserNotification = true;
      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
