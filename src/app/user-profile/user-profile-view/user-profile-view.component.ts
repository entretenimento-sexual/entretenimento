//src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectUserById } from 'src/app/store/selectors/user.selectors';
import { observeUserChanges } from 'src/app/store/actions/user.actions';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';
import { formatDate } from '@angular/common';

enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})
export class UserProfileViewComponent implements OnInit, OnDestroy {

  private sidebarSubscription?: Subscription;  // Subscription para acompanhar o estado da sidebar
  public isSidebarVisible = SidebarState.CLOSED;  // Estado atual da sidebar (aberta ou fechada)
  public uid!: string | null;  // UID do usuário a ser carregado
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
    this.authService.user$.pipe(
      tap(user => {
        this.currentUser = user;
      })
    ).subscribe();

    const routeUid = this.route.snapshot.paramMap.get('id');
    this.uid = routeUid || this.authService.getLoggedUserUID();

    if (this.uid) {
      this.store.dispatch(observeUserChanges({ uid: this.uid }));
      this.usuario$ = this.store.select(selectUserById(this.uid));

      this.usuario$.pipe(
        tap(user => {
          if (user) {
            this.currentUser = user;
            this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
          }
        })
      ).subscribe();
    }

    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      isVisible => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
      }
    );
  }

  // Formata a data usando a função formatDate do Angular
  public formatFirstLoginDate(): string {
    if (!this.currentUser?.firstLogin) {
      return 'Data inválida';
    }

    // Verifique se é um Timestamp e converta para Date
    const date = this.currentUser.firstLogin instanceof Timestamp
      ? this.currentUser.firstLogin.toDate()
      : this.currentUser.firstLogin;

    // Agora utilize o formatDate do Angular
    return formatDate(date, 'dd/MM/yyyy HH:mm', 'pt-BR');
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
