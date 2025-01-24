// src/app/authentication/finalizar-cadastro/finalizar-cadastro.component.ts
import { Component, OnInit } from '@angular/core';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { FirestoreService } from 'src/app/core/services/data-handling/firestore.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Router } from '@angular/router';
import { first, from, of, switchMap } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados'; // Importando o tipo correto
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { IBGELocationService } from 'src/app/core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

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
  public avatarFile: File | null = null;
  public showSubscriptionOptions: boolean = false;
  public formErrors: { [key: string]: string } = {};

  constructor(
    private emailVerificationService: EmailVerificationService,
    private ibgeLocationService: IBGELocationService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private firestoreService: FirestoreService,
    private authService: AuthService,
    private storageService: StorageService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.authService.user$.pipe(first()).subscribe((userData: IUserDados | null) => {
      if (userData) {
        this.verifyEmailAndLoadUser(userData);
      } else {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
          const parsedUser: IUserDados = JSON.parse(storedUser);
          this.authService.setCurrentUser(parsedUser); // Restaura o estado do usuário
          this.verifyEmailAndLoadUser(parsedUser);
        } else {
          this.router.navigate(['/login']); // Redireciona para o login se não houver autenticação nem no localStorage
        }
      }
    });
    this.loadEstados();
  }


  // Alterado para aceitar IUserDados em vez de User
  async verifyEmailAndLoadUser(userData: IUserDados): Promise<void> {
    try {
      console.log('Verificando os dados do usuário:', userData);
      // Apenas exibe mensagem se os dados estiverem incompletos
      if (!userData.gender || !userData.municipio) {
        this.message = 'Por favor, preencha os campos obrigatórios para finalizar seu cadastro.';
      }
    } catch (error) {
      this.message = 'Erro ao verificar o status de cadastro.';
      console.error(error);
      this.router.navigate(['/']);
    } finally {
      this.isLoading = false;
    }
  }

  // Carrega os estados usando a API do IBGE
  loadEstados(): void {
    this.ibgeLocationService.getEstados().subscribe({
      next: (estados) => {
        this.estados = estados;
      },
      error: (err) => {
        console.error('Erro ao carregar estados:', err);
      },
    });
  }

  /**
   * Carrega os municípios ao selecionar um estado.
   */
  onEstadoChange(): void {
    if (!this.selectedEstado) {
      this.municipios = [];
      return;
    }

    this.ibgeLocationService.getMunicipios(this.selectedEstado).subscribe({
      next: (municipios) => {
        this.municipios = municipios;
      },
      error: (err) => {
        console.error('Erro ao carregar municípios:', err);
      },
    });
  }

  onSubmit(): void {
    const uid = this.authService.getLoggedUserUID();

    if (!uid) {
      this.message = 'Erro: UID do usuário não encontrado.';
      console.error('UID do usuário não encontrado.');
      return;
    }

    if (!this.gender || !this.selectedEstado || !this.selectedMunicipio) {
      this.message = 'Por favor, preencha todos os campos obrigatórios.';
      return;
    }

    this.firestoreUserQuery.getUser(uid).pipe(
      first(),
      switchMap((existingUserData: IUserDados | null) => {
        if (!existingUserData) {
          throw new Error('Dados do usuário não encontrados.');
        }

        const updatedUserData: IUserRegistrationData = {
          uid: existingUserData.uid,
          emailVerified: true,
          email: existingUserData.email || '',
          nickname: existingUserData.nickname || '',
          isSubscriber: existingUserData.isSubscriber || false,
          firstLogin: existingUserData.firstLogin || new Date(),
          gender: this.gender || existingUserData.gender || '',
          orientation: this.orientation || existingUserData.orientation || '',
          estado: this.selectedEstado || existingUserData.estado || '',
          municipio: this.selectedMunicipio || existingUserData.municipio || '',
          acceptedTerms: {
            accepted: true,
            date: new Date()
          }
        };

        return from(this.firestoreService.saveInitialUserData(existingUserData.uid, updatedUserData)).pipe(
          switchMap(() => {
            if (this.avatarFile) {
              return this.storageService.uploadProfileAvatar(this.avatarFile, existingUserData.uid);
            } else {
              return of(null);
            }
          })
        );
      }),
      switchMap(() => from(this.emailVerificationService.updateEmailVerificationStatus(uid, true)))
    ).subscribe({
      next: () => {
        this.message = 'Cadastro finalizado com sucesso!';
        this.router.navigate(['/dashboard/principal']);
      },
      error: (error) => {
        console.error('Erro ao finalizar o cadastro:', error);
        this.message = 'Ocorreu um erro ao finalizar o cadastro. Tente novamente mais tarde.';
      }
    });
  }


  // Função para validar os campos do formulário
  checkFieldValidity(field: string, value: any): void {
    if (!value) {
      this.formErrors[field] = `O campo ${field} é obrigatório.`;
    } else {
      this.formErrors[field] = '';
    }
  }

  // Verifica se o campo tem erro
  isFieldInvalid(field: string): boolean {
    return !!this.formErrors[field];
  }

  // Função para lidar com o upload de arquivos (avatar)
  uploadFile(event: any): void {
    const file = event.target.files[0];
    if (!file) {
      this.uploadMessage = 'Nenhum arquivo selecionado.';
      return;
    }

    this.avatarFile = file;  // Armazena o arquivo selecionado
    this.isUploading = true;
    this.progressValue = 0;

    const interval = setInterval(() => {
      if (this.progressValue >= 100) {
        clearInterval(interval);
        this.isUploading = false;
        this.uploadMessage = 'Upload concluído com sucesso!';
      } else {
        this.progressValue += 10;
      }
    }, 300);

    // Tratamento de erro no upload (exemplo)
    setTimeout(() => {
      if (this.progressValue < 100) {
        clearInterval(interval);
        this.isUploading = false;
        this.uploadMessage = 'Erro ao realizar o upload. Tente novamente.';
      }
    }, 5000); // Timeout para simular erro
  }

  goToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }

  continueWithoutSubscription(): void {
    this.router.navigate(['/dashboard/principal']);
  }
}
