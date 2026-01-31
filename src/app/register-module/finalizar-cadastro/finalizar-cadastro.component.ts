// Não esqueça os comentários explicativos.
// Componente para finalizar o cadastro do usuário após o registro inicial.
// Coleta informações adicionais, faz upload de avatar e atualiza o status de verificação de email.
// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.ts
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, finalize, map, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { IBGELocationService } from 'src/app/core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { FirestoreUserWriteService } from 'src/app/core/services/data-handling/firestore-user-write.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css'],
  standalone: false
})
export class FinalizarCadastroComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  public email = '';
  public nickname = '';
  public gender = '';
  public orientation = '';
  public selectedEstado = '';
  public selectedMunicipio = '';
  public estados: any[] = [];
  public municipios: any[] = [];

  public message = '';
  public isLoading = true;
  public isUploading = false;
  public progressValue = 0;
  public uploadMessage = '';
  public avatarFile: any | null = null;

  public showSubscriptionOptions = false;
  public formErrors: { [key: string]: string } = {};

  constructor(
    private emailVerificationService: EmailVerificationService,
    private ibgeLocationService: IBGELocationService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private firestoreUserWrite: FirestoreUserWriteService,
    private currentUserStore: CurrentUserStoreService,
    private storageService: StorageService,
    private route: ActivatedRoute,
    private router: Router,
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotification: ErrorNotificationService,
  ) { }

  private getLS(): any {
    try { return (globalThis as any).localStorage ?? null; } catch { return null; }
  }

  ngOnInit(): void {
    // Carrega estados (não depende de auth)
    this.loadEstados();

    // Resolve usuário atual (store -> localStorage -> login)
    this.currentUserStore.user$.pipe(
      take(1),
      switchMap((u) => {
        if (u) return of(u);

        const ls = this.getLS();
        const raw = ls?.getItem?.('currentUser') ?? null;
        if (!raw) return of(null);

        try {
          const parsed = JSON.parse(raw) as IUserDados;
          this.currentUserStore.set(parsed as any);
          return of(parsed);
        } catch {
          return of(null);
        }
      }),
      tap((u) => {
        if (!u?.uid) this.router.navigate(['/login']);
      }),
      switchMap((u) => u?.uid ? this.verifyEmailAndLoadUser$(u) : of(void 0)),
      finalize(() => (this.isLoading = false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      error: (err) => {
        this.globalErrorHandler.handleError(err);
        this.message = 'Erro ao carregar seus dados. Tente novamente.';
        this.errorNotification.showError(this.message);
      }
    });
  }

  // ✅ Mantém o nome, mas agora é reativo e realmente valida o status do Auth
  private verifyEmailAndLoadUser$(userData: IUserDados) {
    return this.firestoreUserQuery.getUser(userData.uid).pipe(
      take(1),
      tap((doc) => {
        // Preenche UI com o que existir
        this.email = doc?.email ?? userData.email ?? '';
        this.nickname = doc?.nickname ?? userData.nickname ?? '';
      }),
      switchMap(() => this.emailVerificationService.reloadCurrentUser().pipe(take(1))),
      tap((authVerified) => {
        // Mensagem apenas orientativa (não “força” nada aqui)
        if (!authVerified) {
          this.message = 'Seu e-mail ainda não aparece como verificado. Se você já verificou, volte e tente novamente.';
        }
      }),
      map(() => void 0)
    );
  }

  loadEstados(): void {
    this.ibgeLocationService.getEstados().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (estados) => { this.estados = estados; },
      error: (err) => {
        this.globalErrorHandler.handleError(err);
        this.errorNotification.showError('Erro ao carregar estados.');
      },
    });
  }

  onEstadoChange(): void {
    if (!this.selectedEstado) { this.municipios = []; return; }

    this.ibgeLocationService.getMunicipios(this.selectedEstado).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (municipios) => { this.municipios = municipios; },
      error: (err) => {
        this.globalErrorHandler.handleError(err);
        this.errorNotification.showError('Erro ao carregar municípios.');
      },
    });
  }

  private getRedirectToAfterCompletion(uid: string): string {
    const raw = this.route.snapshot.queryParamMap.get('redirectTo');
    if (!raw) return `/perfil/${uid}`; // bom default “logado”
    if (!raw.startsWith('/') || raw.startsWith('//')) return `/perfil/${uid}`;
    return raw;
  }

  onSubmit(): void {
    this.currentUserStore.getLoggedUserUID$().pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) {
          const msg = 'Erro: UID do usuário não encontrado.';
          this.message = msg;
          this.errorNotification.showError(msg);
          return of(null);
        }

        if (!this.gender || !this.selectedEstado || !this.selectedMunicipio) {
          const msg = 'Por favor, preencha todos os campos obrigatórios.';
          this.message = msg;
          this.errorNotification.showError(msg);
          return of(null);
        }

        // ✅ pega o status real do Auth
        return this.emailVerificationService.reloadCurrentUser().pipe(
          take(1),
          switchMap((authVerified) =>
            this.firestoreUserQuery.getUser(uid).pipe(
              take(1),
              map((existingUserData) => ({ uid, existingUserData, authVerified }))
            )
          )
        );
      }),
      switchMap((ctx) => {
        if (!ctx) return of(void 0);

        const { uid, existingUserData, authVerified } = ctx;

        if (!existingUserData) {
          throw new Error('Dados do usuário não encontrados.');
        }

        const now = Date.now();

        const updatedUserData: IUserRegistrationData = {
          uid: existingUserData.uid,
          email: existingUserData.email || '',
          nickname: existingUserData.nickname || '',

          // ✅ verdade do Auth, sem “forçar”
          emailVerified: authVerified === true,

          isSubscriber: !!existingUserData.isSubscriber,
          firstLogin: typeof existingUserData.firstLogin === 'number' ? existingUserData.firstLogin : now,
          registrationDate: typeof (existingUserData as any).registrationDate === 'number'
            ? (existingUserData as any).registrationDate
            : now,

          gender: this.gender || existingUserData.gender || '',
          orientation: this.orientation || existingUserData.orientation || '',
          estado: this.selectedEstado || existingUserData.estado || '',
          municipio: this.selectedMunicipio || existingUserData.municipio || '',

          acceptedTerms: existingUserData.acceptedTerms ?? { accepted: true, date: now },

          // ✅ aqui sim: finalização do perfil
          profileCompleted: true,
        };

        return this.firestoreUserWrite.saveInitialUserData$(uid, updatedUserData).pipe(
          switchMap(() => this.avatarFile
            ? this.storageService.uploadProfileAvatar(this.avatarFile, uid)
            : of(null)
          ),
          tap(() => {
            // ✅ mantém store/cache coerente com a navegação e guards
            this.currentUserStore.set(updatedUserData as any);
          }),
          map(() => void 0)
        );
      }),
      finalize(() => (this.isLoading = false)),
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.globalErrorHandler.handleError(err);
        const msg = 'Ocorreu um erro ao finalizar o cadastro. Tente novamente.';
        this.message = msg;
        this.errorNotification.showError(msg);
        return of(void 0);
      })
    ).subscribe({
      next: () => {
        this.message = 'Cadastro finalizado com sucesso!';
        this.currentUserStore.getLoggedUserUID$().pipe(take(1)).subscribe((uid) => {
          const target = uid ? this.getRedirectToAfterCompletion(uid) : '/dashboard/principal';
          this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => { });
        });
      }
    });
  }

  // uploadFile: ok manter como está (globalThis), só recomendo futuramente trocar por progresso real do Storage
  uploadFile(event: any): void {
    const file = event?.target?.files?.[0];
    if (!file) { this.uploadMessage = 'Nenhum arquivo selecionado.'; return; }

    this.avatarFile = file;
    this.isUploading = true;
    this.progressValue = 0;

    const g: any = globalThis as any;
    const timer = g.setInterval(() => {
      if (this.progressValue >= 100) {
        g.clearInterval(timer);
        this.isUploading = false;
        this.uploadMessage = 'Upload concluído com sucesso!';
      } else {
        this.progressValue += 10;
      }
    }, 300);

    g.setTimeout(() => {
      if (this.progressValue < 100) {
        g.clearInterval(timer);
        this.isUploading = false;
        this.uploadMessage = 'Erro ao realizar o upload. Tente novamente.';
      }
    }, 5000);
  }

  checkFieldValidity(field: string, value: unknown): void {
    this.formErrors[field] = value ? '' : `O campo ${field} é obrigatório.`;
  }

  isFieldInvalid(field: string): boolean {
    return !!this.formErrors[field];
  }

  goToSubscription(): void { this.router.navigate(['/subscription-plan']); }
  continueWithoutSubscription(): void { this.router.navigate(['/dashboard/principal']); }
}
 /* 281 linhas, o firestoreService e o authService estão sendo descontinuados,
   buscar realocar métodos para outros serviços mais especializados.
   */
