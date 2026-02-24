// src\app\dashboard\online\online-users-full\online-users-full.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';

import { OnlineUsersComponent } from '../online-users/online-users.component';

@Component({
  selector: 'app-online-users-full',
  standalone: true,
  imports: [CommonModule, RouterModule, OnlineUsersComponent],
  templateUrl: './online-users-full.component.html',
  styleUrls: ['./online-users-full.component.css']
})
export class OnlineUsersFullComponent {
  currentUser$: Observable<IUserDados | null>;

  constructor(private store: Store<AppState>) {
    this.currentUser$ = this.store.select(selectCurrentUser);
  }
}
