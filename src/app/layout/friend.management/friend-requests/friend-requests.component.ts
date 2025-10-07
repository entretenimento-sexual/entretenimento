//src\app\layout\friend.management\friend-requests\friend-requests.component.ts
import { Component, OnInit, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { map, Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadRequests } from 'src/app/store/actions/actions.interactions/actions.friends';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { IFriendRequest } from 'src/app/core/interfaces/friendship/ifriend-request';
import { selectFriendRequests } from 'src/app/store/selectors/selectors.interactions/friend.selector';

@Component({
  selector: 'app-friend-requests',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule, MatCardModule],
  templateUrl: './friend-requests.component.html',
  styleUrl: './friend-requests.component.css'
})
export class FriendRequestsComponent implements OnInit {
  readonly user = input.required<IUserDados>();
           friendRequests$!: Observable<IFriendRequest[]>;
           isLoading$: Observable<boolean> = this.cacheService.get<boolean>('loadingRequests').pipe(
           map(value => value ?? false)
       );

  constructor(
    private store: Store<AppState>,
    private userInteractionsService: UserInteractionsService,
    private errorNotifier: ErrorNotificationService,
    private cacheService: CacheService
  ) { }

  ngOnInit(): void {
    if (!this.user()?.uid) return;

    this.store.dispatch(loadRequests());
    this.friendRequests$ = this.store.select(selectFriendRequests);
  }

  acceptRequest(req: IFriendRequest): void {
    const me = this.user();
    if (!me?.uid || !req?.requesterUid) return;

    this.cacheService.set('loadingRequests', true, 5000);
    this.userInteractionsService.acceptFriendRequest(me.uid, req.requesterUid).subscribe({
      next: () => {
        this.cacheService.set('loadingRequests', false);
        this.errorNotifier.showSuccess(`Agora você é amigo de ${req.requesterUid}.`);
      },
      error: (err: unknown) => {
        this.cacheService.set('loadingRequests', false);
        const msg = (err as any)?.message ?? String(err);
        this.errorNotifier.showError('Erro ao aceitar solicitação.', msg);
      }
    });
  }

  rejectRequest(req: IFriendRequest): void {
    const me = this.user();
    if (!me?.uid || !req?.requesterUid) return;

    this.cacheService.set('loadingRequests', true, 5000);
    this.userInteractionsService.rejectFriendRequest(me.uid, req.requesterUid).subscribe({
      next: () => {
        this.cacheService.set('loadingRequests', false);
        this.errorNotifier.showInfo(`Você recusou a solicitação de ${req.requesterUid}.`);
      },
      error: (err: unknown) => {
        this.cacheService.set('loadingRequests', false);
        const msg = (err as any)?.message ?? String(err);
        this.errorNotifier.showError('Erro ao recusar solicitação.', msg);
      }
    });
  }
}
