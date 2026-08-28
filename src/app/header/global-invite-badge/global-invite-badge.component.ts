// src/app/header/global-invite-badge/global-invite-badge.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import { combineLatest, Observable } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import {
  selectInviteOwnerUid,
  selectPendingInvitesCount,
} from 'src/app/store/selectors/selectors.chat/invite.selectors';
import { AppState } from 'src/app/store/states/app.state';

interface GlobalInviteBadgeVm {
  readonly count: number;
  readonly countLabel: string;
  readonly ariaLabel: string;
  readonly visible: boolean;
}

@Component({
  selector: 'app-global-invite-badge',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './global-invite-badge.component.html',
  styleUrls: ['./global-invite-badge.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalInviteBadgeComponent {
  private readonly authSession = inject(AuthSessionService);
  private readonly store = inject<Store<AppState>>(Store);

  @Input() mobile = false;

  readonly vm$: Observable<GlobalInviteBadgeVm> = combineLatest([
    this.authSession.uid$.pipe(
      map((uid) => String(uid ?? '').trim() || null),
      distinctUntilChanged()
    ),
    this.store.select(selectInviteOwnerUid),
    this.store.select(selectPendingInvitesCount),
  ]).pipe(
    map(([sessionUid, ownerUid, rawCount]) => {
      const count =
        !!sessionUid && ownerUid === sessionUid
          ? this.normalizeCount(rawCount)
          : 0;

      return {
        count,
        countLabel: count > 99 ? '99+' : String(count),
        ariaLabel:
          count === 1
            ? 'Abrir 1 convite de sala pendente'
            : `Abrir ${count} convites de sala pendentes`,
        visible: count > 0,
      };
    }),
    distinctUntilChanged(
      (previous, current) =>
        previous.count === current.count &&
        previous.visible === current.visible
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private normalizeCount(value: unknown): number {
    const count = Number(value ?? 0);

    if (!Number.isFinite(count) || count <= 0) return 0;
    return Math.floor(count);
  }
}
