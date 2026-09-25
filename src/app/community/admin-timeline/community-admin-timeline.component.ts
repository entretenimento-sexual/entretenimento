// src/app/community/admin-timeline/community-admin-timeline.component.ts
import { AsyncPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  of,
  Subject,
  startWith,
  switchMap,
  take,
  tap,
  catchError,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityAdminTimelineItem,
  CommunityAdminTimelineRole,
} from '../data-access/community-admin-timeline.model';
import { CommunityAdminTimelineRepository } from '../data-access/community-admin-timeline.repository';

type TimelineState =
  | {
      status: 'loading';
      items: readonly CommunityAdminTimelineItem[];
      nextCursor: string | null;
    }
  | {
      status: 'ready';
      items: readonly CommunityAdminTimelineItem[];
      nextCursor: string | null;
    }
  | {
      status: 'loading-more';
      items: readonly CommunityAdminTimelineItem[];
      nextCursor: string | null;
    }
  | {
      status: 'error';
      items: readonly CommunityAdminTimelineItem[];
      nextCursor: string | null;
    };

@Component({
  selector: 'app-community-admin-timeline',
  standalone: true,
  imports: [AsyncPipe, DatePipe],
  templateUrl: './community-admin-timeline.component.html',
  styleUrl: './community-admin-timeline.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityAdminTimelineComponent {
  private readonly repository = inject(CommunityAdminTimelineRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshRequests$ = new Subject<void>();
  private readonly loadMoreRequests$ = new Subject<void>();
  private readonly stateSubject = new BehaviorSubject<TimelineState>({
    status: 'loading',
    items: [],
    nextCursor: null,
  });

  readonly communityId = input.required<string>();
  readonly state$ = this.stateSubject.asObservable();

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter(Boolean),
    distinctUntilChanged()
  );

  constructor() {
    this.communityId$.pipe(
      switchMap((communityId) =>
        this.refreshRequests$.pipe(
          startWith(undefined),
          tap(() => {
            this.stateSubject.next({
              status: 'loading',
              items: [],
              nextCursor: null,
            });
          }),
          switchMap(() =>
            this.repository.getPage$(communityId).pipe(
              tap((page) => {
                this.stateSubject.next({
                  status: 'ready',
                  items: page.items,
                  nextCursor: page.nextCursor,
                });
              }),
              catchError((error: unknown) => {
                this.reportError(error, 'loadCommunityAdminTimeline');
                this.stateSubject.next({
                  status: 'error',
                  items: [],
                  nextCursor: null,
                });
                return of(null);
              })
            )
          )
        )
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();

    this.communityId$.pipe(
      switchMap((communityId) =>
        this.loadMoreRequests$.pipe(
          exhaustMap(() =>
            this.state$.pipe(
              take(1),
              filter(
                (state) =>
                  state.status === 'ready'
                  && state.nextCursor !== null
              ),
              tap((state) => {
                this.stateSubject.next({
                  status: 'loading-more',
                  items: state.items,
                  nextCursor: state.nextCursor,
                });
              }),
              switchMap((state) =>
                this.repository
                  .getPage$(communityId, state.nextCursor)
                  .pipe(
                    tap((page) => {
                      this.stateSubject.next({
                        status: 'ready',
                        items: [...state.items, ...page.items],
                        nextCursor: page.nextCursor,
                      });
                    }),
                    catchError((error: unknown) => {
                      this.reportError(error, 'loadMoreCommunityAdminTimeline');
                      this.stateSubject.next({
                        status: 'ready',
                        items: state.items,
                        nextCursor: state.nextCursor,
                      });
                      return of(null);
                    })
                  )
              )
            )
          )
        )
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  refresh(): void {
    this.refreshRequests$.next();
  }

  loadMore(): void {
    this.loadMoreRequests$.next();
  }

  eventText(item: CommunityAdminTimelineItem): string {
    const actor = item.actor.label;
    const subject = item.subject?.label ?? 'Participante';

    if (item.eventType === 'member_role_changed') {
      return `${actor} alterou a função de ${subject} para ${this.roleLabel(
        item.details.nextRole
      )}.`;
    }

    if (item.eventType === 'member_blocked') {
      return `${actor} bloqueou ${subject}.`;
    }
    if (item.eventType === 'member_unblocked') {
      return `${actor} desbloqueou ${subject}.`;
    }
    if (item.eventType === 'member_removed') {
      return `${actor} removeu ${subject} da Comunidade.`;
    }
    if (item.eventType === 'membership_approved') {
      return `${actor} aprovou a entrada de ${subject}.`;
    }
    if (item.eventType === 'membership_rejected') {
      return `${actor} recusou a solicitação de ${subject}.`;
    }
    if (item.eventType === 'ownership_transferred') {
      return `${actor} transferiu a propriedade para ${subject}.`;
    }
    if (item.eventType === 'community_archived') {
      return `${actor} arquivou a Comunidade.`;
    }
    if (item.eventType === 'settings_changed') {
      const fields = (item.details.changedFields ?? [])
        .map((field) => this.settingsFieldLabel(field))
        .join(', ');
      return fields
        ? `${actor} alterou configurações: ${fields}.`
        : `${actor} alterou configurações da Comunidade.`;
    }
    if (item.eventType === 'content_removed') {
      return `${actor} removeu ${this.targetLabel(item.details.target)}.`;
    }
    if (item.eventType === 'topic_moderated') {
      return `${actor} ${this.topicActionLabel(item.details.action)} um tópico.`;
    }
    if (item.eventType === 'official_status_changed') {
      return `O vínculo oficial foi atualizado para ${this.statusLabel(
        item.details.nextStatus
      )}.`;
    }

    return `O estado da Comunidade mudou de ${this.statusLabel(
      item.details.previousStatus
    )} para ${this.statusLabel(item.details.nextStatus)}.`;
  }

  categoryLabel(item: CommunityAdminTimelineItem): string {
    if (item.category === 'membership') return 'Participantes';
    if (item.category === 'ownership') return 'Propriedade';
    if (item.category === 'settings') return 'Configurações';
    if (item.category === 'moderation') return 'Moderação';
    if (item.category === 'official') return 'Vínculo oficial';
    return 'Lifecycle';
  }

  private roleLabel(role: CommunityAdminTimelineRole | null | undefined): string {
    if (role === 'owner') return 'Proprietário';
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  private settingsFieldLabel(field: string): string {
    const labels: Readonly<Record<string, string>> = {
      name: 'nome',
      description: 'descrição',
      rules: 'regras',
      joinPolicy: 'política de entrada',
      membersCanInvite: 'permissão de convites',
      memberLimit: 'capacidade',
      tagIds: 'interesses',
    };

    return labels[field] ?? 'configuração';
  }

  private targetLabel(
    target: CommunityAdminTimelineItem['details']['target']
  ): string {
    if (target === 'comment') return 'um comentário';
    if (target === 'reply') return 'uma resposta';
    if (target === 'topic') return 'um tópico';
    return 'uma publicação';
  }

  private topicActionLabel(
    action: CommunityAdminTimelineItem['details']['action']
  ): string {
    if (action === 'locked') return 'bloqueou';
    if (action === 'unlocked') return 'desbloqueou';
    return 'removeu';
  }

  private statusLabel(status: string | null | undefined): string {
    const labels: Readonly<Record<string, string>> = {
      active: 'ativo',
      paused: 'pausado',
      dormant: 'inativo',
      archived: 'arquivado',
      scheduled_for_deletion: 'agendado para exclusão',
      pending: 'pendente',
      under_review: 'em análise',
      verified: 'verificado',
      rejected: 'recusado',
      disputed: 'em contestação',
      revoked: 'revogado',
      expired: 'expirado',
    };

    return labels[String(status ?? '')] ?? 'estado atualizado';
  }

  private reportError(error: unknown, operation: string): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage: 'Não foi possível carregar o histórico administrativo.',
      notification: 'none',
      metadata: {
        scope: 'CommunityAdminTimelineComponent',
        communityId: this.communityId().trim(),
      },
    });
  }
}
