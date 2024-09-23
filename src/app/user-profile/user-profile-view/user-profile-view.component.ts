//src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, Observable } from 'rxjs';
import { tap, map, switchMap } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';

enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css', '../user-profile.css',
    './css-teste-user-profile-view.css']
})
export class UserProfileViewComponent implements OnInit, OnDestroy {

  private sidebarSubscription?: Subscription;
  private userSubscription?: Subscription;
  public isSidebarVisible = SidebarState.CLOSED;
  public usuario$: Observable<IUserDados | null> = new Observable<IUserDados | null>();
  public uid!: string | null;
  public preferences: any;
  public currentUser: IUserDados | null = null; // Armazena o usuário autenticado

  objectKeys(obj: any): string[] {
    return Object.keys(obj).filter(key => obj[key] && obj[key].value);
  }

  isCouple(gender: string | undefined): boolean {
    if (!gender) {
      return false;
    }
    return ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
  }

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private sidebarService: SidebarService,
    private usuarioService: UsuarioService
  ) { }

  ngOnInit(): void {
    // Centralizar a assinatura do usuário autenticado
    this.userSubscription = this.authService.user$.pipe(
      tap(user => this.currentUser = user),
      switchMap(currentUser => {
        const userId = this.route.snapshot.paramMap.get('id') || currentUser?.uid;

        if (!userId) {
          console.error('UserID é undefined');
          return [];
        }

        this.uid = userId;

        // Carregar o perfil do usuário
        return this.usuarioService.getUsuario(userId).pipe(
          tap(user => console.log('Usuário recuperado do serviço:', user)),
          map(user => {
            if (user && user.firstLogin instanceof Timestamp) {
              console.log('Convertendo firstLogin de Timestamp para Date');
              user.firstLogin = user.firstLogin.toDate();
            }
            return user;
          }),
          tap(user => {
            console.log('Usuário após processamento:', user);
            if (user) {
              this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
              console.log('Estado da Sidebar definido para:', this.isSidebarVisible);
            }
          })
        );
      })
    ).subscribe(usuario => {
      this.usuario$ = new Observable<IUserDados | null>(observer => observer.next(usuario));
    });

    // Iniciar a assinatura para a visibilidade da sidebar
    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      isVisible => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
        console.log('Visibilidade da Sidebar atualizada para:', isVisible ? 'Aberta' : 'Fechada');
      }
    );
  }

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

  ngOnDestroy(): void {
    this.sidebarSubscription?.unsubscribe();
    this.userSubscription?.unsubscribe(); // Desinscrever-se corretamente
  }

  isOnOwnProfile(): boolean {
    return this.currentUser?.uid === this.uid; // Evita a necessidade de múltiplas assinaturas
  }
}
