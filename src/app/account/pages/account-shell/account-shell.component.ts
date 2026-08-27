// src/app/account/pages/account-shell/account-shell.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { distinctUntilChanged, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';

@Component({
  selector: 'app-account-shell',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './account-shell.component.html',
  styleUrl: './account-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountShellComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly accountLifecycleFacade = inject(AccountLifecycleFacade);

  ngOnInit(): void {
    this.accountLifecycleFacade.shouldUseStatusPage$
      .pipe(
        distinctUntilChanged(),
        tap((shouldUseStatusPage) => {
          if (!shouldUseStatusPage) return;

          this.router.navigate(['/conta/status'], {
            replaceUrl: true,
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }
}
