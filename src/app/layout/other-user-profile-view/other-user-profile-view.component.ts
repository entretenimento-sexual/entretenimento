// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SharedModule } from "../../shared/shared.module";
import { catchError, finalize, of } from 'rxjs';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';
import { UserProfilePreferencesComponent } from 'src/app/user-profile/user-profile-view/user-profile-preferences/user-profile-preferences.component';
// ⬇️ novos imports para o tratamento centralizado
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-other-user-profile-view',
  templateUrl: './other-user-profile-view.component.html',
  styleUrls: ['./other-user-profile-view.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    SocialLinksAccordionComponent,
    UserProfilePreferencesComponent,
  ]
})
export class OtherUserProfileViewComponent implements OnInit {
  uid: string | null = null;
  userProfile: IUserDados | null = null;

  categoriasDePreferencias = {
    genero: [] as string[],
    praticaSexual: [] as string[],
  };

  isLoading = true;

  constructor(
    private route: ActivatedRoute,
    private firestoreUserQuery: FirestoreUserQueryService,
    private cdr: ChangeDetectorRef,
    // ⬇️ injeções para centralizar o erro
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotification: ErrorNotificationService
  ) { }

  ngOnInit() {
    this.uid = this.route.snapshot.paramMap.get('id');

    if (!this.uid) {
      this.reportError('UID não encontrado na rota.', { routeParams: this.route.snapshot.params });
      this.isLoading = false;
      return;
    }

    this.loadUserProfile(this.uid);
  }

  /** Centraliza o tratamento e notificação de erros */
  private reportError(message: string, extra?: Record<string, unknown>, cause?: unknown): void {
    // Cria um Error nativo (compatível com ErrorHandler)
    const err = new Error(message);

    // Anexa metadados opcionais para o GlobalErrorHandler / logger
    (err as any).context = 'OtherUserProfileViewComponent';
    (err as any).extra = { uid: this.uid, ...extra };
    if (cause !== undefined) (err as any).cause = cause;

    // Envia para o handler global (tipo aceito: Error | HttpErrorResponse)
    this.globalErrorHandler.handleError(err);

    // Notificação amigável
    this.errorNotification?.showError?.(message);
  }

  loadUserProfile(uid: string): void {
    this.isLoading = true;

    this.firestoreUserQuery.getUserById(uid)
      .pipe(
        catchError((error: unknown) => {
          this.reportError('Falha ao carregar perfil do usuário.', { uid }, error);
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe((profile: IUserDados | null) => {
        if (!profile) {
          // Perfil não encontrado também é um erro de UX (mas não crítico)
          this.reportError('Usuário não encontrado.', { uid });
          this.userProfile = null;
          return;
        }

        this.userProfile = {
          ...profile,
          preferences: Array.isArray(profile.preferences) ? profile.preferences : []
        };

        this.categoriasDePreferencias = {
          genero: this.userProfile.preferences?.filter((p: string) => p?.includes('genero')) || [],
          praticaSexual: this.userProfile.preferences?.filter((p: string) => p?.includes('praticaSexual')) || [],
        };
      });
  }
}
