// src/app/preferences/pages/notification-settings/notification-settings.component.ts
// -----------------------------------------------------------------------------
// NOTIFICATION SETTINGS PAGE
// -----------------------------------------------------------------------------
// Configuração simples de notificações por tipo e do Web Push deste dispositivo.
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
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { NotificationPreferencesService } from 'src/app/core/services/notifications/notification-preferences.service';
import {
  PushNotificationDeviceService,
  PushNotificationDeviceState,
} from 'src/app/core/services/notifications/push-notification-device.service';
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
  private readonly pushDevice = inject(PushNotificationDeviceService);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly busySubject = new BehaviorSubject<ReadonlySet<string>>(new Set());

  readonly vm$ = this.preferences.currentVm$;
  readonly readState$ = this.preferences.currentReadState$;
  readonly busyKeys$ = this.busySubject.asObservable();
  readonly pushDeviceVm$ = this.pushDevice.vm$;

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
      key: 'communities',
      title: 'Comunidades',
      description: 'Novos comentários e atividades do Mural. Avisos essenciais de moderação continuam ativos.',
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

  pushStateLabel(state: PushNotificationDeviceState): string {
    switch (state) {
      case 'active':
        return 'Ativo';
      case 'blocked':
        return 'Bloqueado';
      case 'unsupported':
        return 'Não compatível';
      case 'unconfigured':
        return 'Não configurado';
      case 'error':
        return 'Falha de sincronização';
      case 'inactive':
      default:
        return 'Inativo';
    }
  }

  pushStateDescription(state: PushNotificationDeviceState): string {
    switch (state) {
      case 'active':
        return 'Este navegador está registrado para receber alertas mesmo quando a plataforma estiver em segundo plano.';
      case 'blocked':
        return 'O navegador bloqueou notificações para este site. Reative a permissão nas configurações do navegador e verifique novamente.';
      case 'unsupported':
        return 'Este navegador ou dispositivo não oferece os recursos necessários para Web Push com segurança.';
      case 'unconfigured':
        return 'Web Push ainda não está configurado neste ambiente. Nenhuma permissão será solicitada até a configuração estar completa.';
      case 'error':
        return 'Não foi possível sincronizar este dispositivo. Você pode tentar novamente sem alterar suas preferências por tipo.';
      case 'inactive':
      default:
        return 'Ative somente se quiser receber alertas deste dispositivo fora da Central de Notificações.';
    }
  }

  retryPreferences(): void {
    this.preferences.refreshCurrentPreferences();
  }

  onPushActivate(): void {
    this.pushDevice.activate$().pipe(take(1)).subscribe({
      next: (state) => {
        switch (state) {
          case 'active':
            this.notifier.showSuccess('Notificações deste dispositivo ativadas.');
            return;
          case 'blocked':
            this.notifier.showWarning(
              'As notificações estão bloqueadas nas permissões do navegador.'
            );
            return;
          case 'unsupported':
            this.notifier.showInfo(
              'Este navegador não oferece Web Push compatível.'
            );
            return;
          case 'unconfigured':
            this.notifier.showInfo(
              'Web Push ainda não está configurado neste ambiente.'
            );
            return;
          case 'inactive':
            this.notifier.showInfo(
              'A permissão não foi concedida. As notificações continuam inativas.'
            );
            return;
          case 'error':
            return;
        }
      },
      error: () =>
        this.notifier.showError(
          'Não foi possível ativar as notificações deste dispositivo.'
        ),
    });
  }

  onPushDeactivate(): void {
    this.pushDevice.deactivate$().pipe(take(1)).subscribe({
      next: (state) => {
        if (state === 'inactive') {
          this.notifier.showSuccess('Notificações deste dispositivo desativadas.');
        }
      },
      error: () =>
        this.notifier.showError(
          'Não foi possível concluir a desativação das notificações.'
        ),
    });
  }

  onPushRefresh(): void {
    this.pushDevice.refresh$().pipe(take(1)).subscribe({
      error: () =>
        this.notifier.showError(
          'Não foi possível verificar as notificações deste dispositivo.'
        ),
    });
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
