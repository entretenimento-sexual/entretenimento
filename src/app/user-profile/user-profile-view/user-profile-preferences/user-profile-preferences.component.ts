// src/app/user-profile/user-profile-view/user-profile-preferences/user-profile-preferences.component.ts
// Viewer de preferências alinhado com V2 + fallback legado.
//
// Estratégia:
// - lê V2 primeiro (IUserPreferenceProfile)
// - se V2 estiver vazia, cai para o legado (IUserPreferences)
// - mantém o template atual sem exigir reescrita imediata
// - remove cache/store duplicados do componente
//
// Observações:
// - role continua canônico em IUserDados, não em IUserPreferenceProfile
// - este componente só exibe preferências; não decide permissões

import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, input } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { combineLatest, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';

import { SharedModule } from 'src/app/shared/shared.module';
import { MatExpansionModule } from '@angular/material/expansion';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';

import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { IUserPreferenceProfile } from '@core/interfaces/preferences/user-preference-profile.interface';

import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';
import { UserPreferenceProfileService } from 'src/app/core/services/preferences/user-preference-profile.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { mapeamentoCategorias } from 'src/app/core/interfaces/icategoria-mapeamento';
import {
  hasMeaningfulPreferenceProfile,
  mapProfileToLegacyEditorState,
} from '@core/utils/preferences/preference-mappers';

import { environment } from 'src/environments/environment';

type TCategoriasDePreferencias = Record<
  'genero' | 'praticaSexual' | 'preferenciaFisica' | 'relacionamento',
  string[]
>;

@Component({
  selector: 'app-user-profile-preferences',
  templateUrl: './user-profile-preferences.component.html',
  styleUrls: ['./user-profile-preferences.component.css'],
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, MatExpansionModule, CapitalizePipe],
})
export class UserProfilePreferencesComponent implements OnInit {
  readonly uid = input<string | null>(null);

  public preferences$: Observable<IUserPreferences | null> = of(null);

  public categoriasDePreferencias: TCategoriasDePreferencias = {
    genero: [],
    praticaSexual: [],
    preferenciaFisica: [],
    relacionamento: [],
  };

  private readonly debug = !environment.production;

  constructor(
    private readonly preferenceProfileService: UserPreferenceProfileService,
    private readonly userPreferencesService: UserPreferencesService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly cdr: ChangeDetectorRef,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const userId = (this.uid() ?? '').trim();
    this.dbg('init uid', userId || null);

    if (!userId) {
      this.dbg('uid ausente');
      this.resetCategorias();
      return;
    }

    const profileV2$ = this.preferenceProfileService.getPreferenceProfile$(userId).pipe(
      catchError((error) => {
        this.dbg('erro ao ler V2', error);
        return of(null as IUserPreferenceProfile | null);
      })
    );

    const legacy$ = this.userPreferencesService.getUserPreferences$(userId).pipe(
      catchError((error) => {
        this.dbg('erro ao ler legado', error);
        return of(null as IUserPreferences | null);
      })
    );

    this.preferences$ = combineLatest([profileV2$, legacy$]).pipe(
      map(([profileV2, legacy]) => {
        if (hasMeaningfulPreferenceProfile(profileV2)) {
          this.dbg('viewer usando V2');
          return mapProfileToLegacyEditorState(profileV2);
        }

        if (legacy) {
          this.dbg('viewer usando legado');
          return legacy;
        }

        this.dbg('nenhuma preferência encontrada');
        return null;
      }),
      tap((preferences) => {
        if (!preferences) {
          this.resetCategorias();
          this.cdr.detectChanges();
          return;
        }

        this.agruparPreferencias(preferences);
        this.cdr.detectChanges();
      }),
      catchError((error) => {
        this.dbg('erro final no viewer', error);
        this.errorNotifier.showError('Não foi possível carregar as preferências.');
        this.resetCategorias();
        this.cdr.detectChanges();
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private resetCategorias(): void {
    this.categoriasDePreferencias = {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: [],
    };
  }

  /**
   * Compatibilidade dupla:
   * - aceita arrays por categoria (shape legado agrupado / estado do editor)
   * - aceita flags booleanas soltas (shape legado antigo)
   */
  private agruparPreferencias(preferencias: IUserPreferences): void {
    this.resetCategorias();

    const categoriasBase = ['genero', 'praticaSexual', 'preferenciaFisica', 'relacionamento'] as const;

    // 1) Formato agrupado por categoria
    for (const categoria of categoriasBase) {
      const valor = preferencias?.[categoria];
      if (Array.isArray(valor)) {
        this.categoriasDePreferencias[categoria] = [...valor];
      }
    }

    // 2) Formato antigo por flags booleanas
    Object.keys(preferencias ?? {}).forEach((key) => {
      if (!preferencias[key]) return;
      if (categoriasBase.includes(key as any)) return;

      for (const categoria in mapeamentoCategorias) {
        if (mapeamentoCategorias[categoria as keyof typeof mapeamentoCategorias].includes(key)) {
          if (!this.categoriasDePreferencias[categoria as keyof TCategoriasDePreferencias].includes(key)) {
            this.categoriasDePreferencias[categoria as keyof TCategoriasDePreferencias].push(key);
          }
          break;
        }
      }
    });

    this.dbg('categoriasDePreferencias', this.categoriasDePreferencias);
  }

  onPreferenceClick(preference: string): void {
    this.dbg('preference click', preference);
    this.router.navigate(['/buscar'], {
      queryParams: { preferencia: preference },
    });
  }

  public objectKeys(obj: unknown): string[] {
    return obj && typeof obj === 'object' ? Object.keys(obj as object) : [];
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[UserProfilePreferencesComponent] ${message}`, extra ?? '');
  }
} // Linha 194