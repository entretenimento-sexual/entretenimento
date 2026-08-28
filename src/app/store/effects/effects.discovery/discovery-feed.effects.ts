// src/app/store/effects/effects.discovery/discovery-feed.effects.ts

import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { concatLatestFrom } from '@ngrx/operators';

import { of } from 'rxjs';
import {
  catchError,
  exhaustMap,
  filter,
  map,
  switchMap,
} from 'rxjs/operators';

import { DiscoveryPublicProfilesRepository } from 'src/app/dashboard/discovery/data-access/discovery-public-profiles.repository';
import { buildDiscoveryFeedQueryKey } from 'src/app/dashboard/discovery/models/discovery-feed-page.model';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import * as DiscoveryActions from '../../actions/actions.discovery/discovery-feed.actions';
import { selectDiscoveryFeedSlice } from '../../selectors/selectors.discovery/discovery-feed.selectors';
import { AppState } from '../../states/app.state';

@Injectable()
export class DiscoveryFeedEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);
  private readonly repository = inject(DiscoveryPublicProfilesRepository);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  readonly loadFirstOrRefresh$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        DiscoveryActions.loadDiscoveryFirstPage,
        DiscoveryActions.refreshDiscoveryFeed
      ),
      switchMap(({ request }) =>
        this.repository.loadPage$(request, null).pipe(
          map((page) =>
            DiscoveryActions.loadDiscoveryPageSuccess({
              request,
              page,
              append: false,
            })
          ),
          catchError((error: unknown) => {
            this.report(error, {
              operation: 'load-first-or-refresh',
              mode: request.mode,
            });

            return of(
              DiscoveryActions.loadDiscoveryPageFailure({
                request,
                error: this.toErrorMessage(error),
              })
            );
          })
        )
      )
    )
  );

  readonly loadNext$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DiscoveryActions.loadDiscoveryNextPage),
      concatLatestFrom(({ request }) =>
        this.store.select(
          selectDiscoveryFeedSlice(buildDiscoveryFeedQueryKey(request))
        )
      ),
      filter(([, slice]) =>
        !slice.loadingInitial &&
        !slice.loadingMore &&
        !slice.refreshing &&
        !slice.reachedEnd &&
        slice.nextCursor !== null
      ),
      exhaustMap(([{ request }, slice]) =>
        this.repository.loadPage$(request, slice.nextCursor).pipe(
          map((page) =>
            DiscoveryActions.loadDiscoveryPageSuccess({
              request,
              page,
              append: true,
            })
          ),
          catchError((error: unknown) => {
            this.report(error, {
              operation: 'load-next',
              mode: request.mode,
              cursorUid: slice.nextCursor?.uid ?? null,
            });

            return of(
              DiscoveryActions.loadDiscoveryPageFailure({
                request,
                error: this.toErrorMessage(error),
              })
            );
          })
        )
      )
    )
  );

  private report(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    const normalized = error instanceof Error
      ? error
      : new Error('Falha ao carregar a descoberta paginada.');

    (normalized as any).original = error;
    (normalized as any).context = {
      scope: 'DiscoveryFeedEffects',
      ...context,
    };
    (normalized as any).skipUserNotification = true;

    this.globalErrorHandler.handleError(normalized);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return 'Falha ao carregar perfis.';
  }
}
