// src/app/notifications/notifications-page/notifications-page.component.ts
// -----------------------------------------------------------------------------
// NOTIFICATIONS PAGE
// -----------------------------------------------------------------------------
// Central de notificações internas.
//
// Segurança:
// - apenas lê o stream já protegido por Rules;
// - não marca como lida nesta etapa;
// - links usam route interna validada pelo Angular Router.
// -----------------------------------------------------------------------------

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';
import { IAppNotification } from 'src/app/core/interfaces/app-notification.interface';

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

  readonly vm$ = this.notificationService.currentUserVm$;

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
}
