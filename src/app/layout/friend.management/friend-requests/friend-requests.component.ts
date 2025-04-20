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

@Component({
  selector: 'app-friend-requests',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule, MatCardModule],
  templateUrl: './friend-requests.component.html',
  styleUrl: './friend-requests.component.css'
})
export class FriendRequestsComponent implements OnInit {
  readonly user = input.required<IUserDados>();
  friendRequests$!: Observable<IUserDados[]>;
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
    this.friendRequests$ = this.store.pipe(select(state => state.friends.requests));
  }

  acceptRequest(friend: IUserDados): void {
    const user = this.user();
    if (!friend?.uid || !user?.uid) return;

    this.cacheService.set('loadingRequests', true, 5000);
    this.userInteractionsService.acceptFriendRequest(user.uid, friend.uid).subscribe({
      next: () => {
        this.cacheService.set('loadingRequests', false);
        this.errorNotifier.showSuccess(`Agora você é amigo de ${friend.nickname || friend.uid}!`);
      },
      error: (err) => {
        this.cacheService.set('loadingRequests', false);
        this.errorNotifier.showError('Erro ao aceitar solicitação.', err.message);
      }
    });
  }

  rejectRequest(friend: IUserDados): void {
    const user = this.user();
    if (!friend?.uid || !user?.uid) return;

    this.cacheService.set('loadingRequests', true, 5000);
    this.userInteractionsService.rejectFriendRequest(user.uid, friend.uid).subscribe({
      next: () => {
        this.cacheService.set('loadingRequests', false);
        this.errorNotifier.showInfo(`Você recusou a solicitação de ${friend.nickname || friend.uid}.`);
      },
      error: (err) => {
        this.cacheService.set('loadingRequests', false);
        this.errorNotifier.showError('Erro ao recusar solicitação.', err.message);
      }
    });
  }
}
