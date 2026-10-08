// Mantém a área administrativa coerente com a revogação em tempo real.
// A decisão de segurança continua no backend/Firestore Rules.
import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { doc, onSnapshot } from 'firebase/firestore';
import { EMPTY, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, switchMap } from 'rxjs/operators';

import { AuthSessionService } from '../core/services/autentication/auth/auth-session.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  private sessionSubscription?: Subscription;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly firestore: Firestore,
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
        return new Observable<boolean>((subscriber) =>
          onSnapshot(
            doc(this.firestore, 'users', user.uid),
            { includeMetadataChanges: true },
            (snapshot) => {
              // Sem confirmação do servidor, a área administrativa deve fechar.
              // Isso cobre tanto a primeira leitura quanto a perda de conexão.
              if (snapshot.metadata.fromCache) {
                subscriber.next(false);
                return;
              }
              const value = snapshot.exists() ? snapshot.data() : null;
              const allowed = !!value
                && (value['accountStatus'] == null || value['accountStatus'] === 'active')
                && value['suspended'] !== true
                && value['accountLocked'] !== true
                && value['interactionBlocked'] !== true
                && value['loginAllowed'] !== false
                && (value['role'] === 'admin'
                  || value['admin'] === true
                  || value['superadmin'] === true);
              subscriber.next(allowed);
            },
            (error) => subscriber.error(error)
          )
        );
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
    this.zone.run(() => {
      void this.router.navigate(['/dashboard']);
    });
  }
}
