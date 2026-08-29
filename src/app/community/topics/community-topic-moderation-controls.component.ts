import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  catchError,
  exhaustMap,
  map,
  of,
  shareReplay,
  startWith,
  Subject,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type { CommunityPreviewViewerRole } from '../data-access/community-preview.model';
import {
  CommunityTopicModerationAction,
  CommunityTopicModerationRequest,
  CommunityTopicModerationResponse,
  CommunityTopicStatus,
} from '../data-access/community-topic.model';
import { CommunityTopicRepository } from '../data-access/community-topic.repository';
import { createCommunityTopicRequestId } from './community-topic-request-id';

type CommunityTopicModerationWriteState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' };

const TOPIC_MODERATION_REASON_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    community_topic_moderation_unavailable:
      'A moderação de Discussões não está disponível neste momento.',
    topic_moderation_forbidden:
      'Sua função atual não permite moderar esta discussão.',
    removal_reason_required:
      'Informe um motivo com pelo menos 3 caracteres para remover a discussão.',
    removal_reason_too_long:
      'O motivo da remoção deve ter no máximo 240 caracteres.',
    removed_topic:
      'Uma discussão removida não pode ser reaberta.',
    topic_transition_forbidden:
      'O estado atual desta discussão não permite esta ação.',
    topic_not_found:
      'Esta discussão não está mais disponível.',
    community_not_found:
      'Esta Comunidade não está mais disponível.',
    request_id_conflict:
      'Esta tentativa de moderação não pôde ser confirmada com segurança.',
    moderation_record_inconsistent:
      'O registro desta moderação está inconsistente e exige revisão.',
    topic_projection_inconsistent:
      'A discussão está inconsistente e exige revisão antes de nova moderação.',
    account_restricted:
      'Sua conta não pode executar esta ação administrativa neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de executar esta ação.',
    profile_incomplete:
      'Complete seu perfil antes de executar esta ação.',
  });

@Component({
  selector: 'app-community-topic-moderation-controls',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './community-topic-moderation-controls.component.html',
  styleUrl: './community-topic-moderation-controls.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityTopicModerationControlsComponent {
  private readonly repository = inject(CommunityTopicRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly moderationRequests$ = new Subject<CommunityTopicModerationRequest>();
  private pendingRequest: CommunityTopicModerationRequest | null = null;

  readonly communityId = input<string>('');
  readonly topicId = input<string>('');
  readonly status = input<CommunityTopicStatus>('active');
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly moderated = output<CommunityTopicModerationResponse>();
  readonly removeConfirmationOpen = signal(false);

  readonly removeForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(240),
      ],
    }),
  });

  readonly moderationState$ = this.moderationRequests$.pipe(
    exhaustMap((request) =>
      this.repository.moderateTopic$(request).pipe(
        tap((result) => {
          this.pendingRequest = null;

          if (result.action === 'remove') {
            this.removeConfirmationOpen.set(false);
            this.removeForm.reset({ reason: '' });
          }

          this.moderated.emit(result);
          this.showSuccess(this.successMessage(result));
        }),
        map((): CommunityTopicModerationWriteState => ({ status: 'idle' })),
        startWith<CommunityTopicModerationWriteState>({ status: 'loading' }),
        catchError((error: unknown) => {
          this.reportError(error);
          return of<CommunityTopicModerationWriteState>({ status: 'error' });
        })
      )
    ),
    startWith<CommunityTopicModerationWriteState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  canModerate(): boolean {
    const role = this.viewerRole();
    return role === 'owner' || role === 'admin' || role === 'moderator';
  }

  submitStatusAction(): void {
    if (!this.canModerate()) return;

    const action: CommunityTopicModerationAction =
      this.status() === 'locked' ? 'unlock' : 'lock';
    this.submit(action, null);
  }

  openRemoveConfirmation(): void {
    if (!this.canModerate()) return;
    this.removeConfirmationOpen.set(true);
  }

  cancelRemove(): void {
    this.removeConfirmationOpen.set(false);
    this.removeForm.reset({ reason: '' });

    if (this.pendingRequest?.action === 'remove') {
      this.pendingRequest = null;
    }
  }

  submitRemoval(): void {
    if (!this.canModerate()) return;

    const reason = this.removeForm.controls.reason.value.trim();
    if (this.removeForm.invalid || reason.length < 3 || reason.length > 240) {
      this.removeForm.markAllAsTouched();
      return;
    }

    this.submit('remove', reason);
  }

  removalReasonInvalid(): boolean {
    const control = this.removeForm.controls.reason;
    const length = control.value.trim().length;
    return control.touched && (control.invalid || length < 3 || length > 240);
  }

  private submit(
    action: CommunityTopicModerationAction,
    reason: string | null
  ): void {
    const communityId = this.communityId().trim();
    const topicId = this.topicId().trim();
    if (!communityId || !topicId) return;

    const existing = this.pendingRequest;
    const request: CommunityTopicModerationRequest =
      existing
      && existing.communityId === communityId
      && existing.topicId === topicId
      && existing.action === action
      && (existing.reason ?? null) === reason
        ? existing
        : {
            requestId: createCommunityTopicRequestId('moderation'),
            communityId,
            topicId,
            action,
            reason,
          };

    this.pendingRequest = request;
    this.moderationRequests$.next(request);
  }

  private successMessage(result: CommunityTopicModerationResponse): string {
    if (result.action === 'lock') {
      return result.deduplicated ? 'Encerramento confirmado.' : 'Discussão encerrada.';
    }

    if (result.action === 'unlock') {
      return result.deduplicated ? 'Reabertura confirmada.' : 'Discussão reaberta.';
    }

    return result.deduplicated ? 'Remoção confirmada.' : 'Discussão removida.';
  }

  private showSuccess(message: string): void {
    try {
      this.errorNotifier.showSuccess(message);
    } catch {
      // Feedback secundário não invalida uma ação confirmada pelo backend.
    }
  }

  private reportError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'moderateTopic',
      fallbackMessage: 'Não foi possível aplicar a moderação agora.',
      reasonMessages: TOPIC_MODERATION_REASON_MESSAGES,
      codeMessages: {
        'permission-denied':
          'Sua função atual não permite moderar esta discussão.',
        'invalid-argument':
          'Revise o motivo e tente novamente.',
        'failed-precondition':
          'O estado desta discussão mudou. Atualize a discussão antes de moderar novamente.',
        'not-found':
          'Esta discussão não está mais disponível.',
        'data-loss':
          'A discussão está inconsistente e exige revisão antes de nova moderação.',
      },
      metadata: {
        scope: 'CommunityTopicModerationControlsComponent',
        communityId: this.communityId().trim(),
        topicId: this.topicId().trim(),
        viewerRole: this.viewerRole(),
        pendingAction: this.pendingRequest?.action ?? null,
      },
    });
  }
}
