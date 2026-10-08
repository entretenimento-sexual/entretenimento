// Mantém a área administrativa coerente com a revogação em tempo real.
// A decisão de segurança continua no backend/Firestore Rules.
import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, Subscription } from 'rxjs';
import { distinctUntilChanged, switchMap } from 'rxjs/operators';

import { AuthSessionService } from '../core/services/autentication/auth/auth-session.service';
import { AdminPrivilegeWatchService } from './admin-privilege-watch.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  private sessionSubscription?: Subscription;
  private exiting = false;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly privilegeWatch: AdminPrivilegeWatchService,
    private readonly router: Router,
    private readonly zone: NgZone
  ) {}

  ngOnInit(): void {
    this.sessionSubscription = this.authSession.authUser$.pipe(
      distinctUntilChanged((a, b) => a?.uid === b?.uid),
      switchMap((user) => {
        if (!user?.uid) {
          this.exitAdmin();
          return EMPTY;
        }
        return this.privilegeWatch.watch(user.uid);
      })
    ).subscribe({
      next: (allowed) => { if (!allowed) this.exitAdmin(); },
      error: () => this.exitAdmin()
    });
  }

  ngOnDestroy(): void {
    this.sessionSubscription?.unsubscribe();
  }

  private exitAdmin(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.sessionSubscription?.unsubscribe();
    this.zone.run(() => {
      void this.router.navigate(['/dashboard']);
    });
  }
}
