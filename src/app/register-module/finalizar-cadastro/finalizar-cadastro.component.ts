//src\app\register-module\finalizar-cadastro\finalizar-cadastro.component.ts
import { Component, OnInit } from '@angular/core';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { Router } from '@angular/router';
import { of, from, map, take, switchMap  } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { IBGELocationService } from 'src/app/core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { FirestoreUserWriteService } from 'src/app/core/services/data-handling/firestore-user-write.service';

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css'],
  standalone: false
})
export class FinalizarCadastroComponent implements OnInit {
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
  public showSubscriptionOptions: boolean = false;
  public formErrors: { [key: string]: string } = {};

  constructor(
    private emailVerificationService: EmailVerificationService,
    private ibgeLocationService: IBGELocationService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private storageService: StorageService,
    private router: Router,
    // ⬇️ novo store que substitui Service
    private currentUserStore: CurrentUserStoreService,
    private firestoreUserWrite: FirestoreUserWriteService
  ) { }

  private getLS(): any {
    try { return (globalThis as any).localStorage ?? null; } catch { return null; }
  }

  ngOnInit(): void {
    this.currentUserStore.user$.pipe(take(1)).subscribe(userData => {
      if (userData) {
        this.verifyEmailAndLoadUser(userData);
      } else {
        const ls = this.getLS();
        const storedUser = ls?.getItem?.('currentUser') ?? null;      // ⬅️ sem 'Storage'/'window'
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser) as IUserDados;
          this.currentUserStore.set(parsedUser as any);
          this.verifyEmailAndLoadUser(parsedUser);
        } else {
          this.router.navigate(['/login']);
        }
      }
    });

    this.loadEstados();
  }

  async verifyEmailAndLoadUser(userData: IUserDados): Promise<void> {
    try {
      if (!userData.gender || !userData.municipio) {
        this.message = 'Por favor, preencha os campos obrigatórios para finalizar seu cadastro.';
      }
    } catch (error) {
      this.message = 'Erro ao verificar o status de cadastro.';
      console.log(error);
      this.router.navigate(['/']);
    } finally {
      this.isLoading = false;
    }
  }

  loadEstados(): void {
    this.ibgeLocationService.getEstados().subscribe({
      next: (estados) => { this.estados = estados; },
      error: (err) => { console.log('Erro ao carregar estados:', err); },
    });
  }

  onEstadoChange(): void {
    if (!this.selectedEstado) { this.municipios = []; return; }

    this.ibgeLocationService.getMunicipios(this.selectedEstado).subscribe({
      next: (municipios) => { this.municipios = municipios; },
      error: (err) => { console.log('Erro ao carregar municípios:', err); },
    });
  }

  onSubmit(): void {
    this.currentUserStore.getLoggedUserUID$().pipe(  // ⬅️ em vez de user$ + map
      take(1)
    ).subscribe({
      next: (uid) => {
        if (!uid) { this.message = 'Erro: UID do usuário não encontrado.'; console.log('UID do usuário não encontrado.'); return; }
        if (!this.gender || !this.selectedEstado || !this.selectedMunicipio) { this.message = 'Por favor, preencha todos os campos obrigatórios.'; return; }

        this.firestoreUserQuery.getUser(uid).pipe(
          take(1),
          switchMap((existingUserData: IUserDados | null) => {
            if (!existingUserData) throw new Error('Dados do usuário não encontrados.');
            const now = Date.now();
            const updatedUserData: IUserRegistrationData = {
              uid: existingUserData.uid,
              emailVerified: true,
              email: existingUserData.email || '',
              nickname: existingUserData.nickname || '',
              isSubscriber: !!existingUserData.isSubscriber,
              firstLogin: typeof existingUserData.firstLogin === 'number' ? existingUserData.firstLogin : now,
              gender: this.gender || existingUserData.gender || '',
              orientation: this.orientation || existingUserData.orientation || '',
              estado: this.selectedEstado || existingUserData.estado || '',
              municipio: this.selectedMunicipio || existingUserData.municipio || '',
              acceptedTerms: { accepted: true, date: now },
              profileCompleted: true
            };

            return from(this.firestoreUserWrite.saveInitialUserData$(existingUserData.uid, updatedUserData)).pipe(
              switchMap(() => this.avatarFile
                ? this.storageService.uploadProfileAvatar(this.avatarFile, existingUserData.uid)
                : of(null)
              )
            );
          }),
          switchMap(() => from(this.emailVerificationService.updateEmailVerificationStatus(uid, true)))
        ).subscribe({
          next: () => { this.message = 'Cadastro finalizado com sucesso!'; this.router.navigate(['/dashboard/principal']); },
          error: (error: unknown) => { console.log('Erro ao finalizar o cadastro:', error); this.message = 'Ocorreu um erro ao finalizar o cadastro. Tente novamente mais tarde.'; },
        });
      },
      error: (error: unknown) => { console.log('Erro ao obter UID do usuário:', error); this.message = 'Erro ao processar sua solicitação. Tente novamente.'; },
    });
  }

  // c) upload: use globalThis em vez de window/setInterval “nus”
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
} /* 189 linhas, o firestoreService e o authService estão sendo descontinuados,
   buscar realocar métodos para outros serviços mais especializados.
   */
