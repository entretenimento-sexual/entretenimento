// src/app/header/links-interaction/links-interaction.component.ts
// Componente para interação com links no cabeçalho.
// Inclui contadores de solicitações de amizade, mensagens não lidas e convites pendentes.
// Gerencia upload de fotos e edição via modal.
// Não esquecer os comentários explicativos.
// Visando sempre semelhança com outros componentes e boas práticas de Angular e as grandes plataformas.
import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import { selectInboundRequestsCount } from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { selectInboundRequestsRichVM } from 'src/app/store/selectors/selectors.interactions/friends';

import { Router, NavigationEnd } from '@angular/router';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

import { distinctUntilChanged, filter, map, take, startWith, tap, shareReplay, auditTime } from 'rxjs/operators';
import { Observable, Subscription, firstValueFrom, combineLatest } from 'rxjs';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import { environment } from 'src/environments/environment';
import { SidebarService } from 'src/app/core/services/sidebar.service';

@Component({
  selector: 'app-links-interaction',
  templateUrl: './links-interaction.component.html',
  styleUrls: ['./links-interaction.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LinksInteractionComponent implements OnInit, OnDestroy {
  private store = inject(Store<AppState>);
  private modalService = inject(NgbModal);
  private notificationService = inject(ChatNotificationService);
  private sidebarService = inject(SidebarService);

  private router = inject(Router);
  private authSession = inject(AuthSessionService);

  sidebarOpen$ = this.sidebarService.isSidebarVisible$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * ✅ Fonte única e compartilhada do UID.
   * Evita múltiplas subscriptions em authUser$ (que pode ter side-effects).
   */
  // TODO(AUTH SOURCE OF TRUTH): Trocar authSession.authUser$ por AuthSession.uid$ (e ready$).
  // - Motivo: AuthSession é dono do UID (fonte canônica).
  // - Evita decisões “cedo demais” no cold start (ready=false).
  private readonly authUid$ = this.authSession.authUser$.pipe(
    map(u => (u?.uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  userId$: Observable<string | null> = this.authUid$;

  isLogged$: Observable<boolean> = this.authUid$.pipe(
    map(uid => !!uid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );


  // Contadores
  pendingFriendReqCount$ = this.store.select(selectInboundRequestsCount);
  unreadMessagesCount$ = this.notificationService.unreadMessagesCount$;
  pendingInvitesCount$ = this.notificationService.pendingInvitesCount$;

  // Mini-inbox
  inboundRequestsVM$ = this.store.select(selectInboundRequestsRichVM);

  private sub = new Subscription();

  private dbg(...args: any[]) {
    if (!environment.production) console.log('[LinksInteraction]', ...args);
  }

  // ✅ mesmo regex do Orchestrator
  private inRegistrationFlow(url: string): boolean {
    return /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
  }

  private url$ = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map(e => e.urlAfterRedirects || e.url),
    startWith(this.router.url || ''),
    distinctUntilChanged()
  );

  private inReg$ = this.url$.pipe(
    map(url => this.inRegistrationFlow(url)),
    distinctUntilChanged()
  );

  // ✅ “pode ouvir realtime?” (por enquanto: apenas estar logado e fora do registro)
  // TODO(GATING): Expandir canListen$ para incluir emailVerified$ (se notificações exigirem verificação).
  // - Sugestão: logged && verified && !inRegistrationFlow
  // - Mantém coerência com guards e impede listeners antes do “estado liberado”.
  private canListen$ = combineLatest([this.isLogged$, this.inReg$]).pipe(
    map(([logged, inReg]) => logged && !inReg),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnInit(): void {
    this.sub.add(
      combineLatest([this.userId$, this.canListen$]).pipe(
        map(([uid, can]) => (uid && can) ? uid : null),
        distinctUntilChanged(),
        tap((uid) => {
          if (!uid) {
            this.notificationService.stopUnreadMessagesMonitoring('gate-off');
            return;
          }
          this.notificationService.monitorUnreadMessages(uid);
        })
      ).subscribe()
    );

    // ✅ Log com "rate limit" para não destruir o console
    this.sub.add(
      combineLatest([this.userId$, this.canListen$, this.url$]).pipe(
        auditTime(250),
        tap(([uid, can, url]) => this.dbg('gate', { uid, can, url }))
      ).subscribe()
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.notificationService.stopUnreadMessagesMonitoring('destroy');
  }

  // TODO(ROBUSTNESS): Ajustar firstValueFrom para filtrar direto por (uid && canListen===true),
  // evitando “pegar uid e depois bloquear por can=false”.

  // Ações do mini-menu
  async refreshInboundOnOpen() {
    const [uid, can] = await firstValueFrom(
      combineLatest([this.userId$, this.canListen$]).pipe(
        filter(([uid]) => !!uid),
        take(1)
      )
    );
    if (!can) return;
    this.store.dispatch(A.loadInboundRequests({ uid: uid! }));
  }

  async accept(req: { id: string; requesterUid: string; targetUid?: string }) {
    const [me, can] = await firstValueFrom(
      combineLatest([this.userId$, this.canListen$]).pipe(
        filter(([uid]) => !!uid),
        take(1)
      )
    );
    if (!can) return;
    this.store.dispatch(A.acceptFriendRequest({ requestId: req.id, requesterUid: req.requesterUid, targetUid: me! }));
  }

  decline(req: { id: string }) {
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  async block(req: { id: string; requesterUid: string }) {
    const [me, can] = await firstValueFrom(
      combineLatest([this.userId$, this.canListen$]).pipe(
        filter(([uid]) => !!uid),
        take(1)
      )
    );
    if (!can) return;
    this.store.dispatch(A.blockUser({ ownerUid: me!, targetUid: req.requesterUid }));
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  onUploadPhotoClick(): void {
    const modalRef = this.modalService.open(UploadPhotoComponent, { size: 'lg' });
    modalRef.componentInstance.photoSelected.subscribe((file: File) => this.openPhotoEditorWithFile(file));
  }

  openPhotoEditorWithFile(file: File): void {
    const editorModalRef = this.modalService.open(PhotoEditorComponent, { size: 'lg' });
    editorModalRef.componentInstance.imageFile = file;
  }
}/*Linha 155
 AuthSession manda no UID
CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
*/
