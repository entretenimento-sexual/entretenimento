// src/app/preferences/pages/notification-settings/notification-settings.component.ts
// -----------------------------------------------------------------------------
// NOTIFICATION SETTINGS PAGE
// -----------------------------------------------------------------------------
// Configuração simples de notificações por tipo.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { finalize, take } from 'rxjs/operators';

import {
  INotificationPreferences,
  NotificationPreferenceEditableKey,
} from 'src/app/core/interfaces/notification-preferences.interface';
import { NotificationPreferencesService } from 'src/app/core/services/notifications/notification-preferences.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';
import { PreferencesDomainNavComponent } from '../../components/preferences-domain-nav/preferences-domain-nav.component';

interface NotificationSettingOption {
  key: NotificationPreferenceEditableKey | 'accountSecurity';
  title: string;
  description: string;
  locked?: boolean;
}

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PreferencesPageHeaderComponent,
    PreferencesDomainNavComponent,
  ],
  templateUrl: './notification-settings.component.html',
  styleUrls: ['./notification-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSettingsComponent {
  private readonly preferences = inject(NotificationPreferencesService);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly busySubject = new BehaviorSubject<ReadonlySet<string>>(new Set());

  readonly vm$ = this.preferences.currentVm$;
  readonly busyKeys$ = this.busySubject.asObservable();

  readonly options: NotificationSettingOption[] = [
    {
      key: 'messages',
      title: 'Mensagens',
      description: 'Conversas novas, respostas e retomadas de chat.',
    },
    {
      key: 'connections',
      title: 'Conexões',
      description: 'Solicitações recebidas e conexões aceitas.',
    },
    {
      key: 'rooms',
      title: 'Salas',
      description: 'Convites para salas e movimentações relevantes.',
    },
    {
      key: 'places',
      title: 'Locais',
      description: 'Novos locais ou pontos relevantes para sua região.',
    },
    {
      key: 'compatibleStatus',
      title: 'Status compatível',
      description: 'Alertas futuros quando houver status compatível com suas preferências.',
    },
    {
      key: 'accountSecurity',
      title: 'Conta e segurança',
      description: 'Alertas essenciais de conta, cobrança, segurança e moderação.',
      locked: true,
    },
  ];

  trackOption(_index: number, item: NotificationSettingOption): string {
    return item.key;
  }

  isBusy(key: string): boolean {
    return this.busySubject.value.has(key);
  }

  isEnabled(
    preferences: INotificationPreferences,
    key: NotificationSettingOption['key']
  ): boolean {
    if (key === 'accountSecurity') {
      return true;
    }

    return preferences[key] !== false;
  }

  onToggle(key: NotificationSettingOption['key'], checked: boolean): void {
    if (key === 'accountSecurity' || this.isBusy(key)) {
      return;
    }

    this.setBusy(key, true);

    this.preferences.updateCurrentPreferences$({
      [key]: checked,
    } as Partial<Record<NotificationPreferenceEditableKey, boolean>>).pipe(
      take(1),
      finalize(() => this.setBusy(key, false))
    ).subscribe({
      next: () => this.notifier.showSuccess('Preferência atualizada.'),
      error: () => this.notifier.showError('Não foi possível atualizar a preferência.'),
    });
  }

  private setBusy(key: string, busy: boolean): void {
    const next = new Set(this.busySubject.value);

    if (busy) {
      next.add(key);
    } else {
      next.delete(key);
    }

    this.busySubject.next(next);
  }
}
