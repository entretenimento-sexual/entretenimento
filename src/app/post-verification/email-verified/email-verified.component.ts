// src\app\post-verification\email-verified\email-verified.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';

@Component({
  selector: 'app-email-verified',
  templateUrl: './email-verified.component.html',
  styleUrls: ['./email-verified.component.css']
})
export class EmailVerifiedComponent implements OnInit, OnDestroy {
  public isLoading = true;
  public isEmailVerified = false;
  oobCode: any;
  gender!: string;
  orientation!: string;
  // Propriedades adicionadas
  uid!: string;
  email!: string;
  displayName!: string;
  photoURL!: string;
  selectedFile: File | null = null;
  public uploadMessage: string = '';
  public estados: any[] = [];
  public municipios: any[] = [];
  public selectedEstado: string = '';
  public selectedMunicipio: string = '';

  formErrors: { [key: string]: string } = {
    gender: '',
    orientation: '',
    selectedFile: ''
  };

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private authService: AuthService,
    private emailVerificationService: EmailVerificationService,
    private firestoreService: FirestoreService,
    private route: ActivatedRoute,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.ngUnsubscribe)).subscribe(async params => {
      this.oobCode = params['oobCode'];

      if (this.oobCode) {
        this.emailVerificationService.setCode(this.oobCode);
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
    try {
      // Verifica o código de ação do email
      const verificationSuccess = await this.emailVerificationService.handleEmailVerification(oobCode);

      if (verificationSuccess) {
        console.log('A verificação do e-mail foi bem-sucedida.');

        // Recarrega o usuário para obter o estado mais recente
        const isEmailReloadedAndVerified = await this.emailVerificationService.reloadCurrentUser();

        if (isEmailReloadedAndVerified) {
          this.isEmailVerified = true;

          // Recupera o usuário autenticado atual
          const currentUser = this.authService.currentUser;
          if (currentUser && currentUser.uid) {
            this.uid = currentUser.uid;
            this.email = currentUser.email || '';
            this.displayName = currentUser.displayName || '';
            this.photoURL = currentUser.photoURL || '';

            console.log('Dados do usuário após verificação de e-mail:', {
              uid: this.uid,
              email: this.email,
              displayName: this.displayName,
              photoURL: this.photoURL
            });

            // Atualiza o status de verificação de e-mail no Firestore
            const userDataToUpdate: IUserDados = {
              uid: this.uid,
              email: this.email,
              displayName: this.displayName,
              photoURL: this.photoURL,
              nickname: '', // Você precisa ajustar esta parte conforme seu uso
              role: 'animando',
              lastLoginDate: Timestamp.fromDate(new Date()),// Adicionando a data do último login
              descricao: '',   // Valor padrão ou nulo
              facebook: '',    // Valor padrão ou nulo
              instagram: '',   // Valor padrão ou nulo
              buupe: '',
            };
            await this.firestoreService.saveUserDataAfterEmailVerification(userDataToUpdate);

          } else {
            console.error('Erro ao recuperar o usuário autenticado após a verificação de e-mail');
          }
        } else {
          console.error('Erro ao recarregar o estado de verificação do e-mail do usuário após a verificação.');
        }
      }
    } catch (error) {
      console.error('Falha ao manusear a verificação de e-mail', error);
    } finally {
      this.isLoading = false;  // Finaliza a indicação de carregamento, independentemente de sucesso ou falha

    }
  }

  async onSubmit(): Promise<void> {
    console.log('Formulário enviado');

    if (this.selectedFile) {
      console.log('Arquivo selecionado:', this.selectedFile);
      try {
        const imageUrl = await this.uploadToStorage(this.selectedFile);
        this.photoURL = imageUrl;
      } catch (error) {
        console.error('Erro durante o upload da imagem:', error);
        this.uploadMessage = 'Ocorreu um erro ao fazer o upload da imagem. Por favor, tente novamente com um arquivo diferente.';
        return; // Retorna para não continuar o fluxo
      }
    }

    const agoraTimestamp = Timestamp.fromDate(new Date());

    const dadosDoUsuario: IUserDados = {
      uid: this.uid,
      email: this.email,
      displayName: this.displayName,
      photoURL: this.photoURL,
      gender: this.gender,
      orientation: this.orientation,
      estado: this.selectedEstado,
      municipio: this.selectedMunicipio,
      role: 'animando', // Valor temporário.
      lastLoginDate: agoraTimestamp,
      descricao: '',   // Valor padrão ou nulo
      facebook: '',    // Valor padrão ou nulo
      instagram: '',   // Valor padrão ou nulo
      buupe: '',
    };

    console.log('Criando dadosDoUsuario:', dadosDoUsuario);
    // Recuperando o nickname do localStorage e atribuindo a dadosDoUsuario
    const storedNickname = localStorage.getItem('tempNickname');
    if (storedNickname) {
      dadosDoUsuario.nickname = storedNickname;
      console.log('Nickname do localStorage:', storedNickname);
      // Removendo o nickname temporário após o uso
      localStorage.removeItem('tempNickname');
    }

    this.authService.saveUserToFirestore(dadosDoUsuario).then(() => {
      console.log('Dados do usuário salvos com sucesso');
      this.router.navigate([`/perfil/${this.uid}`]);
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
    return new Promise((resolve, reject) => {
      if (!this.uid) {
        reject(new Error('UID do usuário não está disponível'));
        return;
      }

      // Verificar tamanho da imagem (por exemplo, mínimo de 100KB e máximo de 2MB)
      const fileSizeInKB = file.size / 1024;
      if (fileSizeInKB < 100 || fileSizeInKB > 3072) {
        this.uploadMessage = 'O tamanho do arquivo deve estar entre 100KB e 3MB';
        reject(new Error('O tamanho do arquivo deve estar entre 100KB e 3MB'));
        return;
      }

      // Verificar o tipo de arquivo
      const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
      if (!validMimeTypes.includes(file.type)) {
        this.uploadMessage = 'Formato de imagem inválido. Formatos aceitos: JPEG, PNG, GIF, BMP, WEBP.';
        reject(new Error('Formato de imagem inválido. Por favor, envie uma imagem em um formato válido.'));
        return;
      }

      const storage = getStorage();
      const storageRef = ref(storage, `avatares/${this.uid}.jpg`);

      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log('Upload is ' + progress + '% done');
        },
        (error) => {
          console.error('Erro no upload:', error);
          reject(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          console.log('Arquivo disponível em', downloadURL);
          resolve(downloadURL);
        }
      );
    });
  }

}
