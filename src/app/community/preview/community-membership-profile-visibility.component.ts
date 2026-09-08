import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  Subject,
  catchError,
  combineLatest,
  exhaustMap,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  CommunityMembershipDisclosureMode,
  CommunityMembershipProfileVisibility,
  CommunityMembershipProfileVisibilityState,
} from '../data-access/community-membership-profile-visibility.model';
import { CommunityMembershipProfileVisibilityRepository } from '../data-access/community-membership-profile-visibility.repository';

type VisibilityLoadState =
  | { status: 'loading'; value: null }
  | { status: 'ready'; value: CommunityMembershipProfileVisibilityState }
  | { status: 'error'; value: null };

type VisibilityAction =
  | { kind: 'member'; value: CommunityMembershipProfileVisibility }
  | { kind: 'policy'; value: CommunityMembershipDisclosureMode };

type VisibilityActionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' };

@Component({
  selector: 'app-community-membership-profile-visibility',
  standalone: true,
  imports: [AsyncPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (action$ | async; as action) {
      @if (state$ | async; as state) {
        @if (state.status === 'loading') {
          <section class="membership-visibility membership-visibility--state" role="status" aria-live="polite">
            <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
            <span>Carregando privacidade da participação…</span>
          </section>
        } @else if (state.status === 'error') {
          <section class="membership-visibility membership-visibility--state" role="status">
            <span>Não foi possível carregar esta preferência.</span>
            <button type="button" (click)="reload()">Tentar novamente</button>
          </section>
        } @else if (state.value; as value) {
          <section class="membership-visibility" aria-labelledby="membership-visibility-title">
            <div class="membership-visibility__heading">
              <i class="fas fa-user-shield" aria-hidden="true"></i>
              <div>
                <span>Privacidade</span>
                <h2 id="membership-visibility-title">Participação no perfil</h2>
              </div>
            </div>

            <p class="membership-visibility__default-note">
              Sua participação continua privada por padrão. Ela só aparece no seu perfil quando você escolhe explicitamente a opção visível abaixo.
            </p>

            <div class="membership-visibility__members">
              <i class="fas fa-users" aria-hidden="true"></i>
              <div>
                <strong>Integrantes da Comunidade</strong>
                <small>
                  A lista é interna e visível somente para participantes ativos. Ela não publica sua participação no perfil.
                </small>
              </div>
              <a
                [routerLink]="['/dashboard/comunidades', communityId(), 'integrantes']"
                aria-label="Ver integrantes desta Comunidade"
              >
                Ver integrantes
              </a>
            </div>

            @if (value.canManagePolicy) {
              <label class="membership-visibility__switch">
                <input
                  type="checkbox"
                  [checked]="value.disclosureMode === 'opt_in'"
                  [disabled]="action.status === 'loading'"
                  (change)="setPolicy($any($event.target).checked, value)"
                />
                <span>
                  <strong>Permitir opt-in dos membros</strong>
                  <small>
                    Ativar não publica ninguém. Cada membro precisa autorizar a própria participação.
                  </small>
                </span>
              </label>
            }

            @if (value.disclosureMode === 'opt_in') {
              <fieldset class="membership-visibility__choices" [disabled]="action.status === 'loading'">
                <legend>Visibilidade desta participação</legend>

                <label class="membership-visibility__choice">
                  <input
                    type="radio"
                    name="community-membership-profile-visibility"
                    value="hidden"
                    [checked]="value.profileVisibility !== 'visible'"
                    (change)="setMemberVisibility(false, value)"
                  />
                  <span>
                    <strong>Oculta</strong>
                    <small>Esta Comunidade não aparece no seu perfil público.</small>
                  </span>
                </label>

                <label class="membership-visibility__choice">
                  <input
                    type="radio"
                    name="community-membership-profile-visibility"
                    value="visible"
                    [checked]="value.profileVisibility === 'visible'"
                    [disabled]="!value.canChange && value.profileVisibility !== 'visible'"
                    (change)="setMemberVisibility(true, value)"
                  />
                  <span>
                    <strong>Visível no meu perfil</strong>
                    <small>
                      Autoriza somente a exibição desta participação. Papel, UID interno e dados privados não são publicados.
                    </small>
                  </span>
                </label>
              </fieldset>
            } @else {
              <p class="membership-visibility__note">
                Participações permanecem privadas enquanto o opt-in estiver desativado pela Comunidade.
              </p>
            }

            <span class="membership-visibility__live" aria-live="polite">
              @if (action.status === 'loading') { Salvando preferência… }
            </span>
          </section>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .membership-visibility { display: grid; gap: .85rem; padding: 1rem; border: 1px solid var(--app-border-color, rgba(127,127,127,.25)); border-radius: 1rem; background: var(--app-surface, transparent); }
    .membership-visibility__heading { display: flex; align-items: center; gap: .75rem; }
    .membership-visibility__heading span { display: block; font-size: .78rem; opacity: .72; }
    .membership-visibility__heading h2 { margin: .1rem 0 0; font-size: 1rem; }
    .membership-visibility__default-note, .membership-visibility__note { margin: 0; opacity: .82; line-height: 1.45; }
    .membership-visibility__members { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .7rem; align-items: center; padding: .8rem; border: 1px solid var(--app-border-color, rgba(127,127,127,.2)); border-radius: .8rem; }
    .membership-visibility__members > i { color: var(--primary-color, #d83768); }
    .membership-visibility__members > div { display: grid; gap: .18rem; min-width: 0; }
    .membership-visibility__members small { opacity: .78; line-height: 1.4; }
    .membership-visibility__members a { min-height: 2.75rem; display: inline-flex; align-items: center; justify-content: center; padding: .5rem .7rem; border-radius: .65rem; color: var(--primary-color, #d83768); font-size: .78rem; font-weight: 760; text-decoration: none; }
    .membership-visibility__members a:hover, .membership-visibility__members a:focus-visible { background: color-mix(in oklab, var(--app-surface, #fff) 90%, var(--primary-color, #d83768) 10%); }
    .membership-visibility__switch { display: flex; align-items: flex-start; gap: .75rem; cursor: pointer; }
    .membership-visibility__switch input { inline-size: 1.1rem; block-size: 1.1rem; margin-top: .15rem; flex: 0 0 auto; }
    .membership-visibility__switch span, .membership-visibility__choice span { display: grid; gap: .2rem; }
    .membership-visibility__switch small, .membership-visibility__choice small { opacity: .78; line-height: 1.45; }
    .membership-visibility__choices { display: grid; gap: .65rem; margin: 0; padding: .8rem 0 0; border: 0; border-top: 1px solid var(--app-border-color, rgba(127,127,127,.2)); }
    .membership-visibility__choices legend { padding: 0 .25rem 0 0; font-size: .82rem; font-weight: 700; }
    .membership-visibility__choice { display: flex; align-items: flex-start; gap: .75rem; min-height: 2.75rem; cursor: pointer; }
    .membership-visibility__choice input { inline-size: 1.1rem; block-size: 1.1rem; margin-top: .15rem; flex: 0 0 auto; }
    .membership-visibility__live { min-height: 1.2em; font-size: .82rem; opacity: .75; }
    .membership-visibility--state { grid-template-columns: auto 1fr auto; align-items: center; }
    .membership-visibility--state button { min-height: 2.75rem; }
    @media (max-width: 520px) { .membership-visibility { padding: .9rem; } .membership-visibility__members { grid-template-columns: auto minmax(0, 1fr); } .membership-visibility__members a { grid-column: 2; justify-self: start; padding-inline: 0; } .membership-visibility--state { grid-template-columns: 1fr; } }
  `],
})
export class CommunityMembershipProfileVisibilityComponent {
  private readonly repository = inject(CommunityMembershipProfileVisibilityRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly reloadSubject = new BehaviorSubject<number>(0);
  private readonly actionsSubject = new Subject<VisibilityAction>();

  readonly communityId = input.required<string>();

  readonly state$ = combineLatest([
    toObservable(this.communityId),
    this.reloadSubject,
  ]).pipe(
    switchMap(([communityId]) =>
      this.repository.getState$(String(communityId ?? '').trim()).pipe(
        map((value): VisibilityLoadState => ({ status: 'ready', value })),
        catchError((error: unknown) => {
          this.report(error, 'loadCommunityMembershipProfileVisibility');
          return of<VisibilityLoadState>({ status: 'error', value: null });
        }),
        startWith<VisibilityLoadState>({ status: 'loading', value: null })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly action$: Observable<VisibilityActionState> = this.actionsSubject.pipe(
    exhaustMap((action) => {
      const communityId = String(this.communityId() ?? '').trim();
      const operation$: Observable<unknown> = action.kind === 'member'
        ? this.repository.updateVisibility$(communityId, action.value)
        : this.repository.updateDisclosure$(communityId, action.value);

      return operation$.pipe(
        tap(() => {
          this.notifications.showSuccess(
            action.kind === 'member'
              ? action.value === 'visible'
                ? 'Esta Comunidade agora pode aparecer no seu perfil.'
                : 'Esta Comunidade não aparece mais no seu perfil.'
              : action.value === 'opt_in'
                ? 'Os membros agora podem optar por exibir a participação.'
                : 'A exibição de participações foi desativada.'
          );
          this.reload();
        }),
        map((): VisibilityActionState => ({ status: 'idle' })),
        catchError((error: unknown) => {
          this.report(error, action.kind === 'member'
            ? 'updateCommunityMembershipProfileVisibility'
            : 'updateCommunityMembershipDisclosurePolicy');
          this.reload();
          return of<VisibilityActionState>({ status: 'error' });
        }),
        startWith<VisibilityActionState>({ status: 'loading' })
      );
    }),
    startWith<VisibilityActionState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setPolicy(
    enabled: boolean,
    state: CommunityMembershipProfileVisibilityState
  ): void {
    if (!state.canManagePolicy) return;
    this.actionsSubject.next({
      kind: 'policy',
      value: enabled ? 'opt_in' : 'disabled',
    });
  }

  setMemberVisibility(
    visible: boolean,
    state: CommunityMembershipProfileVisibilityState
  ): void {
    if (visible && !state.canChange) {
      this.notifications.showWarning(
        'Esta Comunidade não permite publicar a participação no perfil agora.'
      );
      this.reload();
      return;
    }
    this.actionsSubject.next({
      kind: 'member',
      value: visible ? 'visible' : 'hidden',
    });
  }

  reload(): void {
    this.reloadSubject.next(this.reloadSubject.value + 1);
  }

  private report(error: unknown, operation: string): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage: 'Não foi possível atualizar a privacidade da participação.',
      metadata: {
        scope: 'CommunityMembershipProfileVisibilityComponent',
        communityId: String(this.communityId() ?? '').trim(),
      },
    });
  }
}
