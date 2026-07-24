// src/app/layout/friend-management/friend-settings/friend-settings.component.ts
// Configurações de amizade mantidas no Store da feature.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a chave `loadingSettings` do CacheService.
//   Motivo: loading é estado transitório de interface e não deve ser persistido.
// - SUPRIMIDA a chave `friendSettings` do CacheService.
//   Motivo: o Store já é a fonte reativa desta feature e o cache criava uma
//   segunda fonte de verdade sem isolamento por UID.
// - SUPRIMIDO o setTimeout artificial de 1 segundo.
//   Motivo: ele simulava uma operação assíncrona que não existia.
//
// Observação importante:
// - `updateFriendSettings` atualmente atualiza somente o Store local;
// - não existe effect/repository de Firestore associado a essa action;
// - o feedback informa aplicação nesta sessão, sem prometer persistência remota.
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { distinctUntilChanged } from 'rxjs/operators';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';

import { AppState } from 'src/app/store/states/app.state';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { updateFriendSettings } from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectFriendSettings } from 'src/app/store/selectors/selectors.interactions/friends/settings.selectors';

interface FriendSettingsValue {
  receiveRequests: boolean;
  showOnlineStatus: boolean;
  allowSearchByNickname: boolean;
}

@Component({
  selector: 'app-friend-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatSlideToggleModule,
    MatButtonModule,
  ],
  templateUrl: './friend-settings.component.html',
  styleUrl: './friend-settings.component.css',
})
export class FriendSettingsComponent implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settingsForm = this.fb.group({
    receiveRequests: true,
    showOnlineStatus: true,
    allowSearchByNickname: true,
  });

  ngOnInit(): void {
    this.loadSettings();
  }

  /** Mantém o formulário sincronizado com a fonte reativa da feature. */
  private loadSettings(): void {
    this.store
      .select(selectFriendSettings)
      .pipe(
        distinctUntilChanged((previous, current) =>
          this.areSettingsEqual(previous, current)
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((settings) => {
        this.settingsForm.patchValue(settings, { emitEvent: false });
      });
  }

  /** Aplica as configurações no Store local da sessão atual. */
  saveSettings(): void {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      return;
    }

    const settings: FriendSettingsValue =
      this.settingsForm.getRawValue();

    this.store.dispatch(updateFriendSettings({ settings }));
    this.settingsForm.markAsPristine();

    this.errorNotifier.showSuccess(
      'Configurações de amizade aplicadas nesta sessão.'
    );
  }

  private areSettingsEqual(
    previous: FriendSettingsValue,
    current: FriendSettingsValue
  ): boolean {
    return (
      previous.receiveRequests === current.receiveRequests &&
      previous.showOnlineStatus === current.showOnlineStatus &&
      previous.allowSearchByNickname ===
        current.allowSearchByNickname
    );
  }
}
