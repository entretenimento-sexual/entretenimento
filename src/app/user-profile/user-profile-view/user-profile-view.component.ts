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
    // Assina o observable do usuário autenticado
    this.authService.user$.pipe(
      tap(user => {
        this.currentUser = user;  // Armazena o usuário autenticado
        console.log('Usuário autenticado:', this.currentUser);
      })
    ).subscribe();

    // Recupera o UID da rota ou do usuário autenticado
    const routeUid = this.route.snapshot.paramMap.get('id');
    this.uid = routeUid || this.authService.getLoggedUserUID();  // Fallback para o UID do usuário autenticado
    console.log('UID encontrado:', this.uid);

    if (this.uid) {
      // Dispara a ação para observar mudanças no usuário
      console.log('Disparando ação observeUserChanges para UID:', this.uid);
      this.store.dispatch(observeUserChanges({ uid: this.uid }));

      // Atribui o observable de usuário ao this.usuario$
      this.usuario$ = this.store.select(selectUserById(this.uid));

      // Assina o observable para capturar o usuário
      this.usuario$.pipe(
        tap(user => {
          if (user) {
            console.log('Usuário recuperado do Store:', user);

            // Cria uma cópia do objeto e converte firstLogin se necessário
            let userCopy = { ...user };
            if (user.firstLogin && user.firstLogin instanceof Timestamp) {
              console.log('Convertendo firstLogin de Timestamp para Date');
              user.firstLogin = user.firstLogin.toDate();
            }

            // Define o estado da Sidebar com base no estado armazenado
            this.isSidebarVisible = userCopy.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
            console.log('Estado da Sidebar definido para:', this.isSidebarVisible);
          } else {
            console.log('Usuário não encontrado no Store para UID:', this.uid);
          }
        })
      ).subscribe(); // Assinatura para consumir o Observable
    } else {
      console.error('Nenhum UID encontrado, não foi possível carregar o perfil do usuário.');
    }

    // Assina o estado da sidebar para alterar sua visibilidade conforme necessário
    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      isVisible => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
        console.log('Visibilidade da Sidebar atualizada para:', isVisible ? 'Aberta' : 'Fechada');
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
