// src/app/preferences/application/compatibility-preview.facade.ts
// Fachada de compatibilidade.
//
// Objetivo:
// - obter match profile atual
// - obter match profile alvo
// - gerar preview de compatibilidade
// - manter UI desacoplada de infraestrutura

import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { MatchProfile } from '../models/match-profile.model';
import { CompatibilityPreview } from '../models/compatibility-preview.model';

import { MatchProfileFacade } from './match-profile.facade';
import { MatchProfileStoreService } from '../services/match-profile-store.service';
import { CompatibilityPreviewService } from '../services/compatibility-preview.service';

export interface CompatibilityPreviewVm {
  current: MatchProfile | null;
  target: MatchProfile | null;
  preview: CompatibilityPreview | null;
}

@Injectable({ providedIn: 'root' })
export class CompatibilityPreviewFacade {
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly matchProfileFacade = inject(MatchProfileFacade);
  private readonly matchProfileStore = inject(MatchProfileStoreService);
  private readonly compatibilityService = inject(CompatibilityPreviewService);

  getCompatibilityPreviewByTargetUid$(targetUid: string): Observable<CompatibilityPreviewVm> {
    const safeTargetUid = this.normalizeUid(targetUid);

    if (!safeTargetUid) {
      return throwError(() => new Error('[CompatibilityPreviewFacade] targetUid inválido.'));
    }

    return combineLatest([
      this.matchProfileFacade.currentMatchProfileVm$,
      this.matchProfileStore.getMatchProfile$(safeTargetUid),
    ]).pipe(
      map(([currentVm, targetStored]) => {
        const current = currentVm?.built ?? currentVm?.stored ?? null;
        const target = targetStored?.userId ? targetStored : null;

        const preview =
          current && target
            ? this.compatibilityService.compare(current, target)
            : null;

        return {
          current,
          target,
          preview,
        };
      }),
      catchError((err) => {
        this.handleError(
          err,
          'getCompatibilityPreviewByTargetUid$',
          'Não foi possível gerar a prévia de compatibilidade.'
        );
        return of({
          current: null,
          target: null,
          preview: null,
        });
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  private handleError(err: unknown, context: string, userMessage: string): void {
    const e = err instanceof Error ? err : new Error(`[CompatibilityPreviewFacade] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;
    (e as any).feature = 'compatibility_preview';

    this.globalError.handleError(e);
    this.notifier.showError(userMessage);
  }
}