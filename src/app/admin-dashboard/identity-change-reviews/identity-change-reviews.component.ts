import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, finalize } from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  IdentityReviewCursor, IdentityReviewItem,
} from './identity-review.model';
import { IdentityReviewRepository } from './identity-review.repository';

type Decision = 'APPROVE' | 'REJECT';

@Component({
  selector: 'app-identity-change-reviews',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './identity-change-reviews.component.html',
  styleUrls: ['./identity-change-reviews.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdentityChangeReviewsComponent implements OnInit {
  private readonly repository = inject(IdentityReviewRepository);
  private readonly notification = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly itemsSubject = new BehaviorSubject<IdentityReviewItem[]>([]);
  private nextCursor: IdentityReviewCursor | null = null;

  readonly items$ = this.itemsSubject.asObservable();
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly hasMore = signal(false);
  readonly errorText = signal<string | null>(null);
  readonly reviewForm = new FormGroup({
    resolution: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(500)],
    }),
  });
  selected: IdentityReviewItem | null = null;
  decision: Decision | null = null;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loadPage(true);
  }

  loadMore(): void {
    if (!this.nextCursor) return;
    this.loadPage(false);
  }

  beginReview(item: IdentityReviewItem, decision: Decision): void {
    if (this.busy() || (decision === 'APPROVE' && item.structuralChange)) return;
    this.selected = item;
    this.decision = decision;
    this.reviewForm.reset({ resolution: '' });
  }

  cancelReview(): void {
    if (this.busy()) return;
    this.selected = null;
    this.decision = null;
    this.reviewForm.reset({ resolution: '' });
  }

  confirmReview(): void {
    const item = this.selected;
    const decision = this.decision;
    if (!item || !decision || this.busy()) return;
    if (decision === 'APPROVE' && item.structuralChange) return;
    const resolution = this.reviewForm.controls.resolution.value.replace(/\s+/g, ' ').trim();
    if (resolution.length < 8 || resolution.length > 500) {
      this.notification.showWarning('Informe uma justificativa entre 8 e 500 caracteres.');
      return;
    }

    this.busy.set(true);
    this.repository.review$(item.uid, decision, resolution).pipe(
      finalize(() => this.busy.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.notification.showSuccess('Decisão registrada.');
        this.selected = null;
        this.decision = null;
        this.reviewForm.reset({ resolution: '' });
        this.refresh();
      },
      error: (error: unknown) => {
        this.errorText.set('Não foi possível registrar a decisão. Atualize a fila e tente novamente.');
        this.report(error, 'review', { uid: item.uid });
      },
    });
  }

  private loadPage(reset: boolean): void {
    if (this.loading() || (!reset && (this.busy() || !this.nextCursor))) return;
    this.loading.set(true);
    this.errorText.set(null);
    const cursor = reset ? null : this.nextCursor;
    this.repository.getPage$(cursor).pipe(
      finalize(() => this.loading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (page) => {
        const before = reset ? [] : this.itemsSubject.value;
        const byUid = new Map(before.map((item) => [item.uid, item]));
        page.items.forEach((item) => byUid.set(item.uid, item));
        this.itemsSubject.next([...byUid.values()]);
        this.nextCursor = page.nextCursor;
        this.hasMore.set(page.nextCursor !== null);
      },
      error: (error: unknown) => {
        this.errorText.set('Não foi possível carregar as solicitações.');
        this.report(error, 'loadQueue');
      },
    });
  }

  private report(error: unknown, operation: string, metadata: Record<string, unknown> = {}): void {
    this.applicationError.report(error, {
      feature: 'profile-identity-admin',
      operation: 'IdentityChangeReviewsComponent.' + operation,
      fallbackMessage: 'Não foi possível concluir a operação de revisão.',
      metadata: { scope: 'IdentityChangeReviewsComponent', ...metadata },
    });
  }
}
