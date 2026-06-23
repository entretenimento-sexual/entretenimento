// src/app/dashboard/user-intent-status/user-intent-status-radar/user-intent-status-radar.component.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS RADAR
// -----------------------------------------------------------------------------
// Lista status temporários ativos na região do usuário.
// Usa o UID real do Firebase Auth para evitar leitura com UID de perfil divergente.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { Observable, of } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, startWith, switchMap } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';

interface UserIntentStatusRadarVm {
  loading: boolean;
  items: IUserIntentStatusCardVm[];
}

@Component({
  selector: 'app-user-intent-status-radar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './user-intent-status-radar.component.html',
  styleUrls: ['./user-intent-status-radar.component.css'],
})
export class UserIntentStatusRadarComponent implements OnChanges {
  @Input() user: IUserDados | null = null;

  vm$: Observable<UserIntentStatusRadarVm> = of({
    loading: false,
    items: [],
  });

  private readonly statusService = inject(UserIntentStatusService);
  private readonly authSession = inject(AuthSessionService);

  private readonly authUid$ = this.authSession.uid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['user']) {
      return;
    }

    if (!this.user) {
      this.vm$ = of({ loading: false, items: [] });
      return;
    }

    this.vm$ = this.authUid$.pipe(
      switchMap((uid) => {
        if (!uid) {
          return of({ loading: false, items: [] });
        }

        return this.statusService.watchActiveStatusesForUserRegion$(uid, {
          limit: 24,
        }).pipe(
          map((items) => ({
            loading: false,
            items: items.filter((item) => item.uid !== uid),
          })),
          startWith({
            loading: true,
            items: [],
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  trackByStatusId(_index: number, item: IUserIntentStatusCardVm): string {
    return item.id;
  }
}
