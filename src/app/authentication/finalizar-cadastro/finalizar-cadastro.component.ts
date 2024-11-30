// src/app/authentication/finalizar-cadastro/finalizar-cadastro.component.ts
import { Component, OnInit } from '@angular/core';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Router } from '@angular/router';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { first } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados'; // Importando o tipo correto
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { FirestoreQueryService } from 'src/app/core/services/autentication/firestore-query.service';

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
    private firestoreQuery: FirestoreQueryService,
    private firestoreService: FirestoreService,
    private authService: AuthService,
    private usuarioService: UsuarioService,
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
  async loadEstados(): Promise<void> {
    try {
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
      this.estados = await response.json();
      this.estados.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena alfabeticamente os estados
    } catch (error) {
      console.error('Erro ao carregar os estados:', error);
    }
  }

  // Carrega os municípios do estado selecionado usando a API do IBGE
  async onEstadoChange(): Promise<void> {
    if (!this.selectedEstado) return;  // Caso nenhum estado esteja selecionado

    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${this.selectedEstado}/municipios`);
      this.municipios = await response.json();
      this.municipios.sort((a, b) => a.nome.localeCompare(b.nome));  // Ordena os municípios
    } catch (error) {
      console.error('Erro ao carregar os municípios:', error);
    }
  }

  async onSubmit(): Promise<void> {
    const uid = this.authService.getLoggedUserUID();

    if (!uid) {
      this.message = 'Erro: UID do usuário não encontrado.';
      console.error('UID do usuário não encontrado.');
      return;
    }

    // Verificação de campos obrigatórios
    if (!this.gender || !this.selectedEstado || !this.selectedMunicipio) {
      this.message = 'Por favor, preencha todos os campos obrigatórios.';
      return;  // Interrompe o envio até que os campos sejam preenchidos
    }

    try {
      const existingUserData = await this.firestoreQuery.getUser(uid).pipe(first()).toPromise();
      console.log('Dados do usuário do Firestore:', existingUserData);
      if (existingUserData) {
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

        await this.firestoreService.saveInitialUserData(existingUserData.uid, updatedUserData);

        // Verifica se um avatar foi carregado
        if (this.avatarFile) {
          await this.storageService.uploadAvatar(this.avatarFile, existingUserData.uid);  // Chama o método de upload do avatar
        }

        this.message = 'Cadastro finalizado com sucesso!';
        await this.emailVerificationService.updateEmailVerificationStatus(existingUserData.uid, true);
        this.router.navigate(['/dashboard/principal']);
      } else {
        this.message = 'Erro: Dados do usuário não encontrados.';
        console.error('Dados do usuário não encontrados.');
      }
    } catch (error) {
      console.error('Erro ao finalizar o cadastro:', error);
      this.message = 'Ocorreu um erro ao finalizar o cadastro. Tente novamente mais tarde.';
    }
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
