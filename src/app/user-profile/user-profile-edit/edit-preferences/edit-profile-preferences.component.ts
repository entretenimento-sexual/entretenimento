// src/app/user-profile/user-profile-edit/edit-profile-preferences/edit-profile-preferences.component.ts
// Editor legado compatibilizado com V2.
// Estratégia:
// - lê V2 primeiro
// - cai para legado se V2 estiver vazia
// - mantém HTML atual sem reescrita
// - faz dual-write temporário (V2 + legado agrupado)
//
// Observação de arquitetura:
// - role NÃO é persistido em IUserPreferenceProfile
// - role continua canônico em IUserDados / sessão do usuário
// - qualquer limitação por plano/role deve ser gating de UI/serviço

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of, forkJoin } from 'rxjs';
import {
  map,
  switchMap,
  tap,
  catchError,
  finalize,
  first,
  take,
} from 'rxjs/operators';

import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';
import { UserPreferenceProfileService } from 'src/app/core/services/preferences/user-preference-profile.service';

import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { IUserPreferenceProfile } from '@core/interfaces/preferences/user-preference-profile.interface';

import {
  hasMeaningfulPreferenceProfile,
  mapLegacyEditorStateToGroupedLegacy,
  mapLegacyPreferencesToProfile,
  mapProfileToLegacyEditorState,
} from '@core/utils/preferences/preference-mappers';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-edit-profile-preferences',
  templateUrl: './edit-profile-preferences.component.html',
  styleUrls: ['./edit-profile-preferences.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class EditProfilePreferencesComponent implements OnInit {
  uid: string | null = null;
  carregando = true;

  preferencias$: Observable<IUserPreferences | null> = of(null);

  /**
   * Estado que o HTML legado já entende:
   * - flags booleanas por chave
   * - arrays por categoria quando necessário
   */
  preferencias: IUserPreferences = {};

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly userPreferencesService: UserPreferencesService,
    private readonly preferenceProfileService: UserPreferenceProfileService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    console.log('[EditProfilePreferencesComponent] Inicializando...');

    this.route.paramMap.pipe(
      first(),
      map(params => (params.get('uid') ?? params.get('id') ?? '').trim() || null),
      tap(uid => {
        if (!uid) {
          console.log('[EditProfilePreferencesComponent] UID não encontrado na rota.');
          this.carregando = false;
        } else {
          console.log('[EditProfilePreferencesComponent] UID extraído:', uid);
          this.uid = uid;
        }
      }),
      switchMap(uid => {
        if (!uid) return of(null);

        return forkJoin({
          profile: this.preferenceProfileService.getPreferenceProfile$(uid).pipe(
            take(1),
            catchError(() => of(null as IUserPreferenceProfile | null))
          ),
          legacy: this.userPreferencesService.getUserPreferences$(uid).pipe(
            take(1),
            catchError(() => of(null as IUserPreferences | null))
          ),
        }).pipe(
          tap(({ profile, legacy }) => {
            if (hasMeaningfulPreferenceProfile(profile)) {
              this.preferencias = mapProfileToLegacyEditorState(profile);
              console.log('[EditProfilePreferencesComponent] Preferências carregadas da V2.');
              return;
            }

            if (legacy) {
              this.preferencias = { ...legacy };
              console.log('[EditProfilePreferencesComponent] Preferências carregadas do legado.');
              return;
            }

            this.preferencias = {};
            console.log('[EditProfilePreferencesComponent] Nenhuma preferência encontrada. Estado inicial vazio.');
          }),
          map(({ profile, legacy }) =>
            hasMeaningfulPreferenceProfile(profile)
              ? mapProfileToLegacyEditorState(profile)
              : legacy
          ),
          catchError(error => {
            this.errorHandler.handleError(error);
            this.notifier.showError('Erro ao buscar preferências. Tente novamente mais tarde.');
            return of(null);
          }),
          finalize(() => {
            this.carregando = false;
          })
        );
      })
    ).subscribe(preferencias => {
      this.preferencias$ = of(preferencias);
    });
  }

  salvarPreferencias(): void {
    if (!this.uid) {
      this.notifier.showError('Erro: Nenhum UID encontrado.');
      console.log('[EditProfilePreferencesComponent] Tentativa de salvar sem UID.');
      return;
    }

    console.log('[EditProfilePreferencesComponent] Salvando preferências:', this.preferencias);

    const profileV2 = mapLegacyPreferencesToProfile(this.uid, this.preferencias);
    const legacyGrouped = mapLegacyEditorStateToGroupedLegacy(this.preferencias);

    forkJoin([
      this.preferenceProfileService.savePreferenceProfile$(this.uid, profileV2).pipe(take(1)),
      this.userPreferencesService.saveUserPreferences$(this.uid, legacyGrouped).pipe(take(1)),
    ])
      .pipe(
        tap(() => {
          console.log('[EditProfilePreferencesComponent] Preferências salvas com sucesso!');
          this.notifier.showSuccess('Preferências salvas com sucesso!');
          this.router.navigate(['/perfil', this.uid]);
        }),
        catchError(err => {
          this.errorHandler.handleError(err);
          this.notifier.showError('Erro ao salvar preferências. Tente novamente.');
          console.log('[EditProfilePreferencesComponent] Erro ao salvar preferências:', err);
          return of(null);
        })
      )
      .subscribe();
  }

  voltarSemSalvar(): void {
    if (this.uid) {
      console.log('[EditProfilePreferencesComponent] Retornando sem salvar.');
      this.router.navigate(['/perfil', this.uid]);
    } else {
      console.log('[EditProfilePreferencesComponent] Não foi possível retornar, UID ausente.');
    }
  }
}