import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { finalize, take } from 'rxjs/operators';

import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';
import { IAppNotification } from 'src/app/core/interfaces/app-notification.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './notifications-page.component.html',
  styleUrls: ['./notifications-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPageComponent {
  private readonly notificationService = inject(AppNotificationService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly busyIdsSubject = new BehaviorSubject<ReadonlySet<string>>(new Set());
  private readonly markAllBusySubject = new BehaviorSubject(false);

  readonly vm$ = this.notificationService.currentUserVm$;
  readonly busyIds$ = this.busyIdsSubject.asObservable();
  readonly markAllBusy$ = this.markAllBusySubject.asObservable();

  trackNotification(_index: number, item: IAppNotification): string {
    return item.id;
  }

  formatNotificationDate(value: number | null): string {
    if (!value) {
      return 'agora';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'agora';
    }

    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  notificationRoute(item: IAppNotification): string | null {
    const route = String(item.route ?? '').trim();

    if (!route.startsWith('/') || route.startsWith('//')) {
      return null;
    }

    return route;
  }

  markAsRead(item: IAppNotification): void {
    if (item.readAt !== null || this.isBusy(item.id)) {
      return;
    }

    this.setBusy(item.id, true);

    this.notificationService.markAsRead$(item.id).pipe(
      take(1),
      finalize(() => this.setBusy(item.id, false))
    ).subscribe({
      next: () => undefined,
      error: () => this.notifier.showError('Não foi possível marcar a notificação como lida.'),
    });
  }

  markAllAsRead(): void {
    if (this.markAllBusySubject.value) {
      return;
    }

    this.markAllBusySubject.next(true);

    this.notificationService.markAllAsRead$().pipe(
      take(1),
      finalize(() => this.markAllBusySubject.next(false))
    ).subscribe({
      next: (updated) => {
        if (updated > 0) {
          this.notifier.showSuccess('Notificações marcadas como lidas.');
        }
      },
      error: () => this.notifier.showError('Não foi possível marcar as notificações como lidas.'),
    });
  }

  isBusy(id: string): boolean {
    return this.busyIdsSubject.value.has(id);
  }

  private setBusy(id: string, busy: boolean): void {
    const next = new Set(this.busyIdsSubject.value);

    if (busy) {
      next.add(id);
    } else {
      next.delete(id);
    }

    this.busyIdsSubject.next(next);
  }
}
