//src\app\layout\friend.management\friend-settings\friend-settings.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Store, select } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { map, Observable, of } from 'rxjs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { updateFriendSettings } from 'src/app/store/actions/actions.interactions/actions.friends';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-friend-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatSlideToggleModule, MatButtonModule,
            MatProgressSpinnerModule],
  templateUrl: './friend-settings.component.html',
  styleUrl: './friend-settings.component.css'
})

export class FriendSettingsComponent implements OnInit {
  settingsForm!: FormGroup;
  isLoading$: Observable<boolean>;

  constructor(
    private fb: FormBuilder,
    private store: Store<AppState>,
    private errorNotifier: ErrorNotificationService,
    private cacheService: CacheService
  ) {
    this.isLoading$ = this.cacheService.get<boolean>('loadingSettings').pipe(
      map(value => value ?? false)
    );
  }

  ngOnInit(): void {
    this.settingsForm = this.fb.group({
      receiveRequests: [true], // Permitir receber solicitações de amizade
      showOnlineStatus: [true], // Mostrar status online
      allowSearchByNickname: [true] // Permitir ser encontrado por nickname
    });

    // 🔹 Carregar configurações do cache/store ao iniciar
    this.loadSettings();
  }

  /**
   * Carrega as configurações do usuário a partir do cache/store.
   */
  private loadSettings(): void {
    this.cacheService.get<{ receiveRequests: boolean, showOnlineStatus: boolean, allowSearchByNickname: boolean }>('friendSettings')
      .subscribe(settings => {
        if (settings) {
          this.settingsForm.patchValue(settings);
        }
      });
  }

  /**
   * Salva as configurações no Store, CacheService e Firestore.
   */
  saveSettings(): void {
    const settings = this.settingsForm.value;
    this.updateLoadingState(true);

    this.store.dispatch(updateFriendSettings({ settings }));

    // 🔹 Cache para evitar recarregamentos desnecessários
    this.cacheService.set('friendSettings', settings, 600000); // 10 min de cache

    // 🔹 Feedback para o usuário
    setTimeout(() => {
      this.updateLoadingState(false);
      this.errorNotifier.showSuccess('Configurações de amizade atualizadas com sucesso!');
    }, 1000);
  }

  /**
   * Atualiza o estado de carregamento.
   * @param state Estado (true/false)
   */
  private updateLoadingState(state: boolean): void {
    this.cacheService.set('loadingSettings', state, 5000);
  }
}
