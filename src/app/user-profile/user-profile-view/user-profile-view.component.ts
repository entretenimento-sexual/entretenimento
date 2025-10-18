//src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectUserById } from 'src/app/store/selectors/selectors.user/user.selectors';
import { observeUserChanges } from 'src/app/store/actions/actions.user/user.actions';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CommonModule } from '@angular/common';
import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
import { UserProfilePreferencesComponent } from './user-profile-preferences/user-profile-preferences.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import { UserProfileSidebarComponent } from './user-profile-sidebar/user-profile-sidebar.component';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';

enum SidebarState { CLOSED, OPEN }

@Component({
    selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
    styleUrls: ['./user-profile-view.component.css'],
    standalone: true,
    imports: [CommonModule, RouterModule, SocialLinksAccordionComponent,
      UserProfilePreferencesComponent, UserPhotoManagerComponent,
      UserProfileSidebarComponent, DateFormatPipe, CapitalizePipe ]
  })

export class UserProfileViewComponent implements OnInit, OnDestroy {

  private sidebarSubscription?: Subscription;  // Subscription para acompanhar o estado da sidebar
  public isSidebarVisible = SidebarState.CLOSED;  // Estado atual da sidebar (aberta ou fechada)
  public uid: string | null = null;  // UID do usuário a ser carregado
  public currentUser: IUserDados | null = null;  // Armazena o usuário autenticado
  public preferences: any;  // Variável potencialmente usada para armazenar preferências (pode ser necessária)

  // Observable para armazenar o usuário carregado do Store
  public usuario$: Observable<IUserDados | null> = new Observable<IUserDados | null>();

  constructor(
    private route: ActivatedRoute,  // Injeta para acessar parâmetros da rota
    private authService: AuthService,  // Serviço de autenticação
    private sidebarService: SidebarService,  // Serviço que gerencia o estado da sidebar
    private store: Store<AppState>  // Store do NgRx para acessar o estado global
  ) { }

  ngOnInit(): void {
    console.log('[UserProfileViewComponent] Inicializando...');

    // Obtendo o usuário autenticado
    this.authService.user$.pipe(
      tap(user => this.currentUser = user)
    ).subscribe();

    // Obtendo o UID do usuário da URL ou do usuário autenticado
    this.usuario$ = this.route.paramMap.pipe(
      map(params => params.get('id') ?? null), // Se não houver ID na URL, retorna string vazia
      switchMap(uid => {
        if (!uid) {
          return this.authService.getLoggedUserUID$().pipe(
            tap(loggedUid => this.uid = loggedUid ?? null),
            switchMap(loggedUid => loggedUid ? this.store.select(selectUserById(loggedUid)) : of(null))
          );
        }
        this.uid = uid;
        console.log("[UserProfileViewComponent] Buscando usuário pelo UID:", this.uid);
        this.store.dispatch(observeUserChanges({ uid: this.uid })); // Disparando ação para atualizar store
        return this.store.select(selectUserById(this.uid));
      }),
      tap(user => {
        console.log("[UserProfileViewComponent] Usuário carregado:", user);
        if (user) {
          this.currentUser = user;
          this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
        }
      }),
      catchError(error => {
        console.log("[UserProfileViewComponent] Erro ao carregar usuário:", error);
        return of(null);
      })
    );

    // Monitorando estado da sidebar
    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      isVisible => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
      }
    );
  }

   // Obtém as chaves de um objeto (potencialmente para preferências, se necessário)
  objectKeys(obj: any): string[] {
    return Object.keys(obj).filter(key => obj[key] && obj[key].value);
  }

  // Verifica se o gênero do usuário indica um casal
  isCouple(gender: string | undefined): boolean {
    if (!gender) {
      return false;
    }
    return ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
  }

  // Retorna a descrição do casal com base no gênero e orientações dos parceiros
  getCoupleDescription(gender: string | undefined, partner1Orientation: string | undefined, partner2Orientation: string | undefined): string {
    if (gender === 'casal-ele-ele') {
      return `Ele ${this.getOrientationDescription(partner1Orientation)} / Ele ${this.getOrientationDescription(partner2Orientation)}`;
    } else if (gender === 'casal-ele-ela') {
      return `Ele ${this.getOrientationDescription(partner1Orientation)} / Ela ${this.getOrientationDescription(partner2Orientation)}`;
    } else if (gender === 'casal-ela-ela') {
      return `Ela ${this.getOrientationDescription(partner1Orientation)} / Ela ${this.getOrientationDescription(partner2Orientation)}`;
    } else {
      return '';
    }
  }

  // Retorna a descrição da orientação do usuário (ex.: bissexual, homossexual)
  getOrientationDescription(orientation: string | undefined): string {
    switch (orientation) {
      case 'bissexual':
        return 'bissexual';
      case 'homossexual':
        return 'homossexual';
      case 'heterossexual':
        return 'heterossexual';
      case 'pansexual':
        return 'pansexual';
      default:
        return '';
    }
  }

    // Verifica se o perfil exibido pertence ao próprio usuário
  isOnOwnProfile(): boolean {
    return this.currentUser?.uid === this.uid;  // Evita múltiplas assinaturas desnecessárias
  }

  // Executa a lógica de destruição do componente, desinscrevendo-se de observables
  ngOnDestroy(): void {
    this.sidebarSubscription?.unsubscribe();  // Desinscrever-se corretamente
  }
}
