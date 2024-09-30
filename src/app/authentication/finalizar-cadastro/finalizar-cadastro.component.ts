//src\app\authentication\finalizar-cadastro\finalizar-cadastro.component.ts
import { Component, OnInit } from '@angular/core';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-finalizar-cadastro',
  templateUrl: './finalizar-cadastro.component.html',
  styleUrls: ['./finalizar-cadastro.component.css']
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
  public showSubscriptionOptions: boolean = false;
  public formErrors: { [key: string]: string } = {};


  constructor(
    private emailVerificationService: EmailVerificationService,
    private firestoreService: FirestoreService,
    private authService: AuthService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.verifyEmailAndLoadUser();
    this.loadEstados();
  }

  // Verifica se o e-mail do usuário foi verificado
  async verifyEmailAndLoadUser(): Promise<void> {
    try {
      const isVerified = await this.emailVerificationService.reloadCurrentUser();
      if (!isVerified) {
        this.message = 'Erro: Verificação de e-mail necessária.';
        this.router.navigate(['/']);  // Redireciona se o e-mail não estiver verificado
      }
    } catch (error) {
      this.message = 'Erro ao verificar o e-mail.';
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

  // Submissão do formulário de cadastro
  async onSubmit(): Promise<void> {
    const uid = this.authService.getLoggedUserUID();
    if (uid) {
      const userData: IUserRegistrationData = {
        uid,
        emailVerified: true,
        email: this.email || '',  // Valida o email
        nickname: this.nickname || '',
        isSubscriber: false,
        firstLogin: new Date(),
        gender: this.gender || '',
        orientation: this.orientation || '',
        estado: this.selectedEstado || '',
        municipio: this.selectedMunicipio || '',
      };

      try {
        await this.firestoreService.saveInitialUserData(uid, userData);
        this.message = 'Cadastro finalizado com sucesso!';
        await this.emailVerificationService.updateEmailVerificationStatus(uid, 'true');  // Atualiza para 'true'
        this.router.navigate(['/dashboard/principal']);
      } catch (error) {
        this.message = 'Erro ao finalizar o cadastro.';
        console.error('Erro ao salvar os dados:', error);
      }
    } else {
      this.message = 'Erro: UID do usuário não encontrado.';
      console.error('UID do usuário não encontrado.');
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

  // Função para lidar com o upload de arquivos
  uploadFile(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.isUploading = true;
      this.progressValue = 0;
      // Simulação do progresso de upload
      const interval = setInterval(() => {
        if (this.progressValue >= 100) {
          clearInterval(interval);
          this.isUploading = false;
          this.uploadMessage = 'Upload concluído com sucesso!';
        } else {
          this.progressValue += 10;
        }
      }, 300);
    }
  }

  goToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }

  continueWithoutSubscription(): void {
    this.router.navigate(['/dashboard/principal']);
  }
}
