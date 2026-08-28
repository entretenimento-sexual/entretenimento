import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  take,
} from 'rxjs/operators';

import {
  ModerationReportReason,
  ModerationReportTargetType,
} from 'src/app/core/interfaces/moderation/moderation-report.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ModerationReportService } from 'src/app/core/services/moderation/moderation-report.service';

type MediaReportTarget =
  | {
      mediaType: 'photo';
      ownerUid: string;
      mediaId: string;
      targetType: 'photo';
      targetId: string;
    }
  | {
      mediaType: 'video';
      ownerUid: string;
      mediaId: string;
      targetType: 'video' | 'video_comment';
      targetId: string;
    };

interface MediaReportForm {
  reason: FormControl<ModerationReportReason | ''>;
  details: FormControl<string>;
}

@Component({
  selector: 'app-video-report-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './video-report-page.component.html',
  styleUrls: ['./video-report-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoReportPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reports = inject(ModerationReportService);
  private readonly notification = inject(ErrorNotificationService);

  readonly submitting = signal(false);
  readonly submitted = signal(false);

  readonly reasonOptions: ReadonlyArray<{
    value: ModerationReportReason;
    label: string;
  }> = [
    { value: 'spam', label: 'Spam ou golpe' },
    { value: 'harassment', label: 'Assédio ou ameaça' },
    { value: 'hate_or_abuse', label: 'Ódio ou abuso' },
    { value: 'sexual_boundary', label: 'Limite sexual violado' },
    { value: 'illegal_content', label: 'Conteúdo ilegal' },
    { value: 'privacy', label: 'Violação de privacidade' },
    { value: 'minor_safety', label: 'Segurança de menores' },
    { value: 'other', label: 'Outro motivo' },
  ];

  readonly form = new FormGroup<MediaReportForm>({
    reason: new FormControl<ModerationReportReason | ''>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    details: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1200)],
    }),
  });

  readonly target$: Observable<MediaReportTarget | null> = combineLatest([
    this.route.paramMap,
  ]).pipe(
    map(([params]): MediaReportTarget | null => {
      const ownerUid = this.cleanId(params.get('ownerUid'));
      const photoId = this.cleanId(params.get('photoId'));

      if (ownerUid && photoId) {
        return {
          mediaType: 'photo',
          ownerUid,
          mediaId: photoId,
          targetType: 'photo',
          targetId: photoId,
        };
      }

      const videoId = this.cleanId(params.get('videoId'));
      const targetType = this.cleanVideoTargetType(params.get('targetType'));
      const rawTargetId = this.cleanId(params.get('targetId'));
      const targetId = targetType === 'video' ? videoId : rawTargetId;

      return ownerUid && videoId && targetType && targetId
        ? {
            mediaType: 'video',
            ownerUid,
            mediaId: videoId,
            targetType,
            targetId,
          }
        : null;
    }),
    distinctUntilChanged((left, right) =>
      JSON.stringify(left) === JSON.stringify(right)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly detailsLength$ = this.form.controls.details.valueChanges.pipe(
    map((value) => value.trim().length),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  submit(): void {
    if (this.form.invalid || this.submitting() || this.submitted()) {
      this.form.markAllAsTouched();
      return;
    }

    this.target$.pipe(take(1)).subscribe((target) => {
      if (!target) {
        this.notification.showError('O conteúdo denunciado não foi identificado.');
        return;
      }

      const reason = this.form.controls.reason.value;

      if (!reason) {
        return;
      }

      this.submitting.set(true);
      this.reports.createReport$({
        targetType: target.targetType,
        targetId: target.targetId,
        parentTargetId: target.mediaType === 'video' ? target.mediaId : null,
        targetOwnerUid: target.ownerUid,
        reason,
        details: this.form.controls.details.value.trim() || null,
        route: this.sourceRoute(target),
      }).pipe(
        finalize(() => this.submitting.set(false)),
        catchError((error) => {
          this.notification.showError(
            'Não foi possível enviar a denúncia.',
            error instanceof Error ? error.message : undefined
          );
          return of(null);
        })
      ).subscribe((reportId) => {
        if (!reportId) {
          return;
        }

        this.submitted.set(true);
        this.form.disable({ emitEvent: false });
        this.notification.showSuccess('Denúncia enviada para análise.');
      });
    });
  }

  back(target: MediaReportTarget | null): void {
    if (target?.ownerUid) {
      void this.router.navigate([
        '/media/perfil',
        target.ownerUid,
        target.mediaType === 'photo' ? 'fotos-publicas' : 'videos-publicos',
      ]);
      return;
    }

    void this.router.navigate(['/dashboard/principal']);
  }

  targetLabel(target: MediaReportTarget): string {
    if (target.targetType === 'photo') {
      return 'foto';
    }

    return target.targetType === 'video_comment'
      ? 'comentário do vídeo'
      : 'vídeo';
  }

  backLabel(target: MediaReportTarget): string {
    return target.mediaType === 'photo' ? 'fotos' : 'vídeos';
  }

  private sourceRoute(target: MediaReportTarget): string {
    return target.mediaType === 'photo'
      ? `/media/perfil/${target.ownerUid}/fotos-publicas`
      : `/media/perfil/${target.ownerUid}/videos-publicos`;
  }

  private cleanId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private cleanVideoTargetType(
    value: unknown
  ): Extract<MediaReportTarget, { mediaType: 'video' }>['targetType'] | null {
    const normalized = String(value ?? '').trim() as ModerationReportTargetType;
    return normalized === 'video' || normalized === 'video_comment'
      ? normalized
      : null;
  }
}
