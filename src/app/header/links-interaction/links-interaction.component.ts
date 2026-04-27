// src/app/header/links-interaction/links-interaction.component.ts
// ============================================================================
// LINKS INTERACTION
// ----------------------------------------------------------------------------
// Nova proposta desta revisão:
// - deixa de funcionar como "segunda navbar"
// - vira um grupo compacto de utilidades dentro da mesma linha do header
// - as ações passam a ser contextuais por rota
// - o botão de solicitações continua sempre relevante
//
// Regras desta versão:
// - Chat: aparece fora de /chat
// - Enviar foto: aparece em rotas de perfil, mídia e principal
// - Convites: aparece fora de /chat/invite-list
// - Solicitações: sempre disponível para usuário autenticado
//
// Observação:
// - mantive nomenclaturas públicas para reduzir risco de quebra
// - mantive governança central dos listeners com AccessControlService
// ============================================================================
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { environment } from 'src/environments/environment';

import { SidebarService } from 'src/app/core/services/navigation/sidebar.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { selectInboundRequestsCount } from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { selectInboundRequestsRichVM } from 'src/app/store/selectors/selectors.interactions/friends';

import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import * as RT from 'src/app/store/actions/actions.interactions/friends/friends-realtime.actions';

type LinksInteractionVm = {
  currentUrl: string;
  showChatShortcut: boolean;
  showUploadShortcut: boolean;
  showInviteShortcut: boolean;
  compactMode: boolean;
};

@Component({
  selector: 'app-links-interaction',
  templateUrl: './links-interaction.component.html',
  styleUrls: ['./links-interaction.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LinksInteractionComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  private readonly store = inject(Store<AppState>);
  private readonly modalService = inject(NgbModal);
  private readonly notificationService = inject(ChatNotificationService);
  private readonly sidebarService = inject(SidebarService);

  private readonly authSession = inject(AuthSessionService);
  private readonly accessControl = inject(AccessControlService);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  // ===========================================================================
  // UI
  // ===========================================================================

  readonly sidebarOpen$ = this.sidebarService.isSidebarVisible$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ===========================================================================
  // Auth / Gate
  // ===========================================================================

  private readonly authUid$ = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly userId$: Observable<string | null> = this.authUid$;

  readonly isLogged$: Observable<boolean> = this.authUid$.pipe(
    map((uid) => !!uid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly realtimeUid$ = combineLatest([
    this.authUid$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    map(([uid, can]) => (uid && can ? uid : null)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * VM visual/contextual.
   * O componente continua leve e reativo.
   */
  readonly vm$: Observable<LinksInteractionVm> = combineLatest([
    this.accessControl.currentUrl$,
    this.sidebarService.isMobile$,
  ]).pipe(
    map(([url, isMobile]) => {
      const currentUrl = this.normalizeUrl(url);

      return {
        currentUrl,
        showChatShortcut: !currentUrl.startsWith('/chat'),
        showUploadShortcut:
          currentUrl === '/dashboard/principal' ||
          currentUrl.startsWith('/perfil') ||
          currentUrl.startsWith('/media'),
        showInviteShortcut: !currentUrl.startsWith('/chat/invite-list'),
        compactMode: isMobile,
      };
    }),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private activeUid: string | null = null;

  // ===========================================================================
  // Store selectors (template)
  // ===========================================================================

  readonly pendingFriendReqCount$ = this.store.select(selectInboundRequestsCount);
  readonly unreadMessagesCount$ = this.notificationService.unreadMessagesCount$;
  readonly pendingInvitesCount$ = this.notificationService.pendingInvitesCount$;
  readonly inboundRequestsVM$ = this.store.select(selectInboundRequestsRichVM);

  // ===========================================================================
  // Debug
  // ===========================================================================

  private dbg(...args: unknown[]): void {
    if (!environment.production) {
      console.log('[LinksInteraction]', ...args);
    }
  }

  ngOnInit(): void {
    this.realtimeUid$
      .pipe(
        tap((uid) => this.applyRealtimeGate(uid)),
        catchError((err) => {
          this.handleError(err, 'Falha ao governar listeners do header.');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    combineLatest([
      this.authUid$,
      this.accessControl.ready$,
      this.accessControl.inRegistrationFlow$,
      this.accessControl.canListenRealtime$,
      this.accessControl.currentUrl$,
    ])
      .pipe(
        auditTime(250),
        tap(([uid, ready, inReg, can, url]) =>
          this.dbg('gate', { uid, ready, inReg, can, url })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.safeStopAll('destroy');
  }

  private normalizeUrl(url: string | null | undefined): string {
    return (url ?? '').split('?')[0].split('#')[0].trim();
  }

  private applyRealtimeGate(uid: string | null): void {
    if (!uid) {
      if (this.activeUid) {
        this.dbg('gate-off -> stopping (activeUid existed)', this.activeUid);
      }

      this.activeUid = null;
      this.safeStopAll('gate-off');
      return;
    }

    if (this.activeUid && this.activeUid !== uid) {
      this.dbg('uid-change -> stopping previous', { from: this.activeUid, to: uid });
      this.safeStopAll('uid-change');
    }

    if (this.activeUid === uid) {
      return;
    }

    this.activeUid = uid;
    this.dbg('gate-on -> starting realtime', { uid });

    this.safeStartAll(uid);
  }

  private safeStartAll(uid: string): void {
    try {
      this.notificationService.monitorUnreadMessages(uid);
    } catch (err) {
      this.handleError(err, 'Falha ao iniciar monitoramento de mensagens.');
    }

    try {
      this.store.dispatch(A.loadInboundRequests({ uid }));
      this.store.dispatch(A.loadOutboundRequests({ uid }));

      this.store.dispatch(RT.startInboundRequestsListener({ uid }));
      this.store.dispatch(RT.startOutboundRequestsListener({ uid }));
    } catch (err) {
      this.handleError(err, 'Falha ao iniciar listeners de solicitações.');
    }
  }

  private safeStopAll(reason: string): void {
    try {
      this.notificationService.stopUnreadMessagesMonitoring(reason);
    } catch (err) {
      this.handleError(err, 'Falha ao parar monitoramento de mensagens.');
    }

    try {
      this.store.dispatch(RT.stopInboundRequestsListener());
      this.store.dispatch(RT.stopOutboundRequestsListener());
    } catch (err) {
      this.handleError(err, 'Falha ao parar listeners de solicitações.');
    }
  }

  async refreshInboundOnOpen(): Promise<void> {
    const uid = await this.getRealtimeUidOnce();
    if (!uid) return;

    this.store.dispatch(A.loadInboundRequests({ uid }));
  }

  async accept(req: { id: string; requesterUid: string; targetUid?: string }): Promise<void> {
    const me = await this.getRealtimeUidOnce();
    if (!me) return;

    this.store.dispatch(
      A.acceptFriendRequest({
        requestId: req.id,
        requesterUid: req.requesterUid,
        targetUid: me,
      })
    );
  }

  decline(req: { id: string }): void {
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  async block(req: { id: string; requesterUid: string }): Promise<void> {
    const me = await this.getRealtimeUidOnce();
    if (!me) return;

    this.store.dispatch(A.blockUser({ ownerUid: me, targetUid: req.requesterUid }));
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  private async getRealtimeUidOnce(): Promise<string | null> {
    try {
      const uid = await firstValueFrom(this.realtimeUid$.pipe(take(1)));
      return uid ?? null;
    } catch (err) {
      this.handleError(err, 'Falha ao obter UID para ação.');
      return null;
    }
  }

  // ===========================================================================
  // Upload / Editor
  // ===========================================================================

  async onUploadPhotoClick(): Promise<void> {
    try {
      const { UploadPhotoComponent } = await import(
        '../../shared/components-globais/upload-photo/upload-photo.component'
      );

      const modalRef = this.modalService.open(UploadPhotoComponent, { size: 'lg' });

      modalRef.componentInstance.photoSelected
        .pipe(take(1))
        .subscribe({
          next: (file: File) => {
            void this.openPhotoEditorWithFile(file);
          },
          error: (err: unknown) => this.handleError(err, 'Falha ao selecionar foto.'),
        });
    } catch (err) {
      this.handleError(err, 'Falha ao abrir modal de upload.');
    }
  }

  async openPhotoEditorWithFile(file: File): Promise<void> {
    try {
      const { PhotoEditorComponent } = await import(
        '../../photo-editor/photo-editor/photo-editor.component'
      );

      const editorModalRef = this.modalService.open(PhotoEditorComponent, { size: 'lg' });
      editorModalRef.componentInstance.imageFile = file;
    } catch (err) {
      this.handleError(err, 'Falha ao abrir editor de foto.');
    }
  }

  private handleError(err: unknown, userMsg: string): void {
    try {
      this.errorNotifier.showError(userMsg);
    } catch {}

    const e =
      err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : 'Unknown error');

    try {
      this.globalError.handleError(e);
    } catch {}

    this.dbg('error', { userMsg, err: e });
  }
}