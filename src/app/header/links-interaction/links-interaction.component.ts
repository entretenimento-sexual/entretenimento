// src/app/header/links-interaction/links-interaction.component.ts
import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';
import { NotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import {
  selectInboundRequestsCount,
  selectInboundRequests
} from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';

import { distinctUntilChanged, filter, map, take } from 'rxjs/operators';
import { Observable, Subscription, firstValueFrom } from 'rxjs';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectInboundRequestsVM } from 'src/app/store/selectors/selectors.interactions/friends/vm.selectors';

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
  private notificationService = inject(NotificationService);

  // Auth
  userId$: Observable<string | null> = this.store.select(selectCurrentUserUid);
  isLogged$: Observable<boolean> = this.userId$.pipe(map(Boolean), distinctUntilChanged());

  // Contadores
  pendingFriendReqCount$ = this.store.select(selectInboundRequestsCount);
  unreadMessagesCount$ = this.notificationService.unreadMessagesCount$;
  pendingInvitesCount$ = this.notificationService.pendingInvitesCount$;

  // Mini-inbox
  inboundRequestsVM$ = this.store.select(selectInboundRequestsVM);

  private sub = new Subscription();

  ngOnInit(): void {
    this.sub.add(
      this.userId$
        .pipe(filter((uid): uid is string => !!uid), distinctUntilChanged())
        .subscribe(uid => this.notificationService.monitorUnreadMessages(uid))
    );
  }
  ngOnDestroy(): void { this.sub.unsubscribe(); }

  // Ações do mini-menu
  async refreshInboundOnOpen() {
    const uid = await firstValueFrom(this.userId$.pipe(filter(Boolean), take(1)));
    this.store.dispatch(A.loadInboundRequests({ uid }));
  }
  async accept(req: { id: string; requesterUid: string; targetUid?: string }) {
    const me = await firstValueFrom(this.userId$.pipe(filter(Boolean), take(1)));
    this.store.dispatch(A.acceptFriendRequest({ requestId: req.id, requesterUid: req.requesterUid, targetUid: me! }));
  }
  decline(req: { id: string }) {
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }
  async block(req: { id: string; requesterUid: string }) {
    const me = await firstValueFrom(this.userId$.pipe(filter(Boolean), take(1)));
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
}
