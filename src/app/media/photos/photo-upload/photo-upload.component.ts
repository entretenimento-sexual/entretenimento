// src/app/media/photos/photo-upload/photo-upload.component.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
// Upload MVP (fake):
// - Seleciona arquivo, mostra preview
// - "Envia" com progresso simulado (Observable)
// - Bloqueia por policy (MediaPolicyService)
// - Erros sempre via ErrorNotificationService
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { BehaviorSubject, Observable, EMPTY, combineLatest, interval, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, shareReplay, startWith, switchMap, take, tap, withLatestFrom } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaPolicyService, IMediaPolicyResult } from 'src/app/core/services/media/media-policy.service';

type UploadPhase = 'IDLE' | 'READY' | 'UPLOADING' | 'DONE';

@Component({
  selector: 'app-photo-upload',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './photo-upload.component.html',
  styleUrls: ['./photo-upload.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoUploadComponent {
  private readonly destroyRef = inject(DestroyRef); // está esmaecido
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  private readonly DEBUG = true;
  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[PhotoUpload] ${msg}`, data ?? '');
  }

  // ownerUid vindo da rota /perfil/:id/fotos/upload
  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((p) => p.get('uid') ?? ''),
    distinctUntilChanged(),
    tap((id) => this.debug('ownerUid$', id)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) => this.debug('viewerUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([this.viewerUid$, this.ownerUid$]).pipe(
    switchMap(([viewer, owner]) =>
      owner ? this.policy.canViewProfilePhotos$(viewer, owner)
        : of<IMediaPolicyResult>({ decision: 'DENY', reason: 'UNKNOWN' })
    ),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canUpload$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  // File selection reativo
  private readonly fileSubject = new BehaviorSubject<File | null>(null);
  readonly file$: Observable<File | null> = this.fileSubject.asObservable();

  private readonly previewUrlSubject = new BehaviorSubject<string | null>(null);
  readonly previewUrl$: Observable<string | null> = this.previewUrlSubject.asObservable();

  // Upload state
  private readonly phaseSubject = new BehaviorSubject<UploadPhase>('IDLE');
  readonly phase$ = this.phaseSubject.asObservable();

  private readonly progressSubject = new BehaviorSubject<number>(0);
  readonly progress$ = this.progressSubject.asObservable();

  onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) return;

    // Regra mínima (fácil de endurecer depois)
    if (!file.type.startsWith('image/')) {
      this.errorNotifier.showError('Selecione um arquivo de imagem.');
      input.value = '';
      return;
    }

    // Preview local (blob url). Revoke anterior.
    const previous = this.previewUrlSubject.value;
    if (previous) URL.revokeObjectURL(previous);

    const url = URL.createObjectURL(file);
    this.fileSubject.next(file);
    this.previewUrlSubject.next(url);
    this.phaseSubject.next('READY');
    this.progressSubject.next(0);

    this.debug('fileSelected', { name: file.name, type: file.type, size: file.size });
  }

  startUpload(): void {
    combineLatest([this.canUpload$, this.file$]).pipe(
      take(1),
      switchMap(([can, file]) => {
        if (!can) {
          this.errorNotifier.showError('Você não tem permissão para enviar fotos.');
          return EMPTY;
        }
        if (!file) {
          this.errorNotifier.showError('Selecione uma imagem antes de enviar.');
          return EMPTY;
        }

        // Upload fake (simulação)
        this.phaseSubject.next('UPLOADING');
        this.progressSubject.next(0);

        return interval(120).pipe(
          map((tick) => Math.min(100, (tick + 1) * 5)),
          tap((p) => this.progressSubject.next(p)),
          filter((p) => p === 100),
          take(1),
          tap(() => {
            this.phaseSubject.next('DONE');
            this.errorNotifier.showSuccess('Upload concluído (simulado).');
          })
        );
      }),
      catchError((err) => {
        this.errorNotifier.showError(err);
        return EMPTY;
      })
    ).subscribe();
  }

  backToPhotos(ownerUid: string): void {
    this.router.navigate(['/perfil', ownerUid, 'fotos']).catch(() => {
      this.errorNotifier.showError('Falha ao navegar.');
    });
  }
}
