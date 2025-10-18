// src\app\user-profile\user-profile-view\user-profile-preferences\user-profile-preferences.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, input } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, switchMap, take, tap } from 'rxjs/operators';
import { mapeamentoCategorias } from 'src/app/core/interfaces/icategoria-mapeamento';
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { SharedModule } from 'src/app/shared/shared.module';
import { selectCacheItem } from 'src/app/store/selectors/cache.selectors';
import { setCache } from 'src/app/store/actions/cache.actions';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { MatExpansionModule } from '@angular/material/expansion';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';

@Component({
  selector: 'app-user-profile-preferences',
  templateUrl: './user-profile-preferences.component.html',
  styleUrls: ['./user-profile-preferences.component.css'],
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, MatExpansionModule, CapitalizePipe],
})
export class UserProfilePreferencesComponent implements OnInit {
  readonly uid = input<string | null>(null);

  public categoriasDePreferencias: any = {
    genero: [],
    praticaSexual: [],
    preferenciaFisica: [],
    relacionamento: [],
  };

  public preferences$: Observable<IUserPreferences | null> = of(null);

  constructor(
    private userPreferencesService: UserPreferencesService,
    private cacheService: CacheService,
    private errorNotifier: ErrorNotificationService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private store: Store<AppState>,) { }

  ngOnInit(): void {

    const uid = this.uid();
    console.log('[UserProfilePreferencesComponent] Iniciando com UID:', uid);

    if (!uid) { // ✅ Corrigido: Evita erro de null antes de acessar a API
      console.log('[UserProfilePreferencesComponent] UID inválido.');
      return;
    }

    this.preferences$ = this.cacheService.get<IUserPreferences>(`preferences:${uid}`).pipe(
      switchMap((cachedPreferences) => {
        if (cachedPreferences) {
          console.log('[Cache] Preferências encontradas no cache:', cachedPreferences);
          this.agruparPreferencias(cachedPreferences);
          this.cdr.detectChanges();
          return of(cachedPreferences);
        }

        console.log('[Store] Preferências não encontradas no cache. Verificando Store...');
        return this.store.select(selectCacheItem(`preferences:${this.uid()}`)).pipe(
          take(1),
          switchMap((storePreferences) => {
            if (storePreferences) {
              console.log('[Store] Preferências encontradas no Store:', storePreferences);
              this.cacheService.set(`preferences:${this.uid()}`, storePreferences);
              this.agruparPreferencias(storePreferences);
              this.cdr.detectChanges();
              return of(storePreferences);
            }

            console.log('[Firestore] Preferências não encontradas no Store. Buscando no Firestore...');
            return this.userPreferencesService.getUserPreferences$(uid).pipe( // ✅ `this.uid!` pois já foi verificado antes
              take(1),
              tap((fetchedPreferences) => {
                if (fetchedPreferences) {
                  console.log('[Firestore] Preferências carregadas:', fetchedPreferences);
                  const uidValue = this.uid();
                  this.cacheService.set(`preferences:${uidValue}`, fetchedPreferences);
                  this.store.dispatch(setCache({ key: `preferences:${uidValue}`, value: fetchedPreferences }));
                  this.agruparPreferencias(fetchedPreferences);
                  this.cdr.detectChanges();
                }
              }),
              catchError((error) => {
                console.log('[UserProfilePreferencesComponent] Erro ao buscar preferências:', error);
                this.errorNotifier.showError('Não foi possível carregar as preferências.');
                return of(null);
              })
            );
          })
        );
      })
    );
  }



  /**
  * Organiza as preferências do usuário dentro de categorias definidas.
  * @param preferencias Preferências do usuário a serem categorizadas.
  */
  private agruparPreferencias(preferencias: IUserPreferences): void {
    // 🔥 Reinicializa os arrays de categorias antes de preenchê-los novamente
    this.categoriasDePreferencias = {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: [],
    };

    if (!preferencias) {
      console.log("[UserProfilePreferencesComponent] Nenhuma preferência foi encontrada.");
      return;
    }

    // 🔄 Percorre todas as preferências do usuário
    Object.keys(preferencias).forEach((key) => {
      if (preferencias[key]) { // ✅ Apenas adiciona se a preferência estiver ativa
        for (const categoria in mapeamentoCategorias) {
          if (mapeamentoCategorias[categoria as keyof typeof mapeamentoCategorias].includes(key)) {
            this.categoriasDePreferencias[categoria].push(key);
            break; // 🔥 Evita adicionar a mesma chave em múltiplas categorias
          }
        }
      }
    });

    console.log("[UserProfilePreferencesComponent] Preferências agrupadas:", this.categoriasDePreferencias);
  }

  onPreferenceClick(pref: string): void {
    console.log(`Clicou na preferência: ${pref}`);

    // 🚀 No futuro, essa lógica será aprimorada para buscar perfis compatíveis
    this.router.navigate(['/buscar'], { queryParams: { preferencia: pref } });
  }


  /**
 * Retorna as chaves de um objeto para ser usado no template
 * @param obj Objeto do qual queremos as chaves
 * @returns Lista de chaves
 */
  public objectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }
}
