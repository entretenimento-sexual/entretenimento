// src\app\post-verification\email-verified\email-verified.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Timestamp } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { IUserRegistrationData } from '../iuser-registration-data';
import { OobCodeService } from 'src/app/core/services/autentication/oobCode.service';


@Component({
  selector: 'app-email-verified',
  templateUrl: './email-verified.component.html',
  styleUrls: ['./email-verified.component.css']
})
export class EmailVerifiedComponent implements OnInit, OnDestroy {
  public isLoading = true;
  public isEmailVerified = false;
  oobCode: any;
  // Usando a interface IUserRegistrationData para gerenciar os dados do usuário.
  userData: IUserRegistrationData =
  { uid: '',
  email: '',
  nickname: '',
  photoURL: '',
  emailVerified: false,
  isSubscriber: false,
};
  selectedFile: File | null = null;
  isUploading: boolean = false;
  public uploadMessage: string = '';
  public estados: any[] = [];
  public municipios: any[] = [];
  public selectedEstado: string = '';
  public selectedMunicipio: string = '';
  public gender: string = '';
  public orientation: string = '';
  public progressValue: number = 0;


  private ngUnsubscribe = new Subject<void>();

  formErrors: { [key: string]: string } = {
    gender: '',
    orientation: '',
    selectedFile: ''
  };

constructor(
    private authService: AuthService,
    private emailVerificationService: EmailVerificationService,
    private firestoreService: FirestoreService,
    private route: ActivatedRoute,
    private router: Router,
    private oobCodeService: OobCodeService
  ) { }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.ngUnsubscribe)).subscribe(async params => {
      this.oobCode = params['oobCode'];

      if (this.oobCode) {
        this.oobCodeService.setCode(this.oobCode);
        console.log('oobCode recuperado:', this.oobCode);
        await this.handleEmailVerification(this.oobCode);
      } else {
        console.error('oobCode não encontrado');
      }
    });
    this.loadEstados();
  }

  async loadEstados() {
    try {
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
      this.estados = await response.json();
      this.estados.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os estados
    } catch (error) {
      console.error('Erro ao carregar os estados:', error);
    }
  }

  async onEstadoChange() {
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${this.selectedEstado}/municipios`);
      this.municipios = await response.json();
      this.municipios.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os municípios
    } catch (error) {
      console.error('Erro ao carregar os municípios:', error);
    }
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  async handleEmailVerification(oobCode: string): Promise<void> {
    this.isLoading = true;
    try {  // Verifica o código de ação do email
      const verificationSuccess = await this.emailVerificationService.handleEmailVerification();

      if (verificationSuccess) {
        console.log('A verificação do e-mail foi bem-sucedida.');

        // Recarrega o usuário para obter o estado mais recente
        const isEmailReloadedAndVerified = await this.emailVerificationService.reloadCurrentUser();

        if (isEmailReloadedAndVerified) {
          this.isEmailVerified = true;

          // Recupera o usuário autenticado atual
          const currentUser = this.authService.currentUser;
          if (currentUser) {
            // Atualizando os dados de registro com as informações do usuário atual.
            this.userData = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              nickname: currentUser.nickname || '',
              photoURL: currentUser.photoURL || '',
              emailVerified: true,
              isSubscriber: false,
            };
          }
        }
      }
      } catch (error) {
        console.error('Falha ao manusear a verificação de e-mail', error);
      } finally {
        this.isLoading = false;
      }
    } // até aqui está certo, corrija daqui pra baixo pra mim

  async onSubmit(): Promise<void> {
    console.log('Formulário enviado');

    if (this.selectedFile) {
      console.log('Arquivo selecionado:', this.selectedFile);
      try {
        const imageUrl = await this.uploadToStorage(this.selectedFile);
        this.userData.photoURL = imageUrl;
      } catch (error) {
        console.error('Erro durante o upload da imagem:', error);
        this.uploadMessage = 'Ocorreu um erro ao fazer o upload da imagem. Por favor, tente novamente com um arquivo diferente.';
        return; // Retorna para não continuar o fluxo
      }
    }

    const agoraTimestamp = Timestamp.fromDate(new Date());

    const initialUserData: IUserRegistrationData = {
      uid: this.userData.uid,
      email: this.userData.email,
      nickname: this.userData.nickname,
      photoURL: this.userData.photoURL || '',
      // gender e orientation podem ser adicionados aqui se coletados durante o registro
      gender: this.gender,
      orientation: this.orientation,
      estado: this.selectedEstado,
      municipio: this.selectedMunicipio,
      emailVerified: true,
      isSubscriber: false,
    };

    console.log('Criando dadosDoUsuario:', initialUserData);

    // Recuperando o nickname do localStorage e atribuindo a dadosDoUsuario
    const storedNickname = localStorage.getItem('tempNickname');
    if (storedNickname) {
      initialUserData.nickname = storedNickname;
      console.log('Nickname do localStorage:', storedNickname);
      // Removendo o nickname temporário após o uso
      localStorage.removeItem('tempNickname');
    }

    // Aqui está a correção: passamos tanto o uid quanto o initialUserData
    this.firestoreService.saveInitialUserData(initialUserData.uid, initialUserData).then(() => {
      console.log('Dados do usuário salvos com sucesso');
      this.router.navigate([`/perfil/`, this.userData.uid]);
    }).catch(erro => {
      console.error('Erro ao salvar dados do usuário:', erro);
    });
  }


  isFieldInvalid(field: string): boolean {
    return this.formErrors[field] ? true : false;
  }

  checkFieldValidity(field: string, value: any): void {
    if (!value) {
      this.formErrors[field] = `O campo ${field} é obrigatório.`;
    } else {
      this.formErrors[field] = '';
    }
  }

  uploadFile(event: any): void {
    this.selectedFile = event.target.files[0];
    this.checkFieldValidity('selectedFile', this.selectedFile);
    console.log(this.selectedFile);
  }

  async uploadToStorage(file: File): Promise<string> {
    this.isUploading = true; // Inicia o upload
    return new Promise((resolve, reject) => {
      const fileSizeInKB = file.size / 1024;
      if (fileSizeInKB < 100 || fileSizeInKB > 3072) {
        this.uploadMessage = 'O tamanho do arquivo deve estar entre 100KB e 3MB';
        this.isUploading = false; // Finaliza o upload devido ao erro
        reject(new Error('O tamanho do arquivo deve estar entre 100KB e 3MB'));
        return;
      }

      const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
      if (!validMimeTypes.includes(file.type)) {
        this.uploadMessage = 'Formato de imagem inválido. Formatos aceitos: JPEG, PNG, GIF, BMP, WEBP.';
        this.isUploading = false; // Finaliza o upload devido ao erro
        reject(new Error('Formato de imagem inválido. Por favor, envie uma imagem em um formato válido.'));
        return;
      }

      const storage = getStorage();
      const storageRef = ref(storage, `avatares/${this.userData.uid}.jpg`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log('Upload is ' + progress + '% done');
          this.progressValue = progress;
        },
        (error) => {
          console.error('Erro no upload:', error);
          this.isUploading = false;
          reject(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          console.log('Arquivo disponível em', downloadURL);
          this.isUploading = false; // Finaliza o upload com sucesso
          resolve(downloadURL);
        }
      );
    });
  }
}


