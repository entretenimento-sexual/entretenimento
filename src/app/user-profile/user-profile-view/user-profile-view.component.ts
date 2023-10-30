// src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, Observable } from 'rxjs';
import { tap, map } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';


enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})
export class UserProfileViewComponent implements OnInit, OnDestroy {

  private sidebarSubscription?: Subscription;
  public isSidebarVisible = SidebarState.CLOSED;
  public usuario$: Observable<IUserDados | null>;
  public uid!: string | null;

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private sidebarService: SidebarService,
    private usuarioService: UsuarioService
  ) {
    this.usuario$ = new Observable<IUserDados | null>();
  }

  ngOnInit(): void {
    const userId = this.route.snapshot.paramMap.get('id') || this.authService.currentUser?.uid;

    if (!userId) {
      console.error('UserID é undefined');
      return;
    }

    if (!userId) {
      console.error('UserID é undefined');
      return;
    }

    this.uid = userId;
    this.usuario$ = this.usuarioService.getUsuario(userId).pipe(
      map(user => {
        if (user && user.firstLogin) {
          // Verifique se firstLogin é uma instância de Timestamp
          if (user.firstLogin instanceof Timestamp) {
            user.firstLogin = user.firstLogin.toDate();
          }
          return user;
        }
        return null;
      }),
      tap(user => {
        if (user) {
          this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
        }
      })
    );

    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      (isVisible) => this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED
    );
  }

  ngOnDestroy(): void {
    this.sidebarSubscription?.unsubscribe();
  }

  isOnOwnProfile(): boolean {
    return this.uid === this.authService.currentUser?.uid;
  }
}
