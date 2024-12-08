// src\app\user-profile\user-profile-edit\edit-user-profile\edit-user-profile.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';

@Component({
    selector: 'app-edit-user-profile',
    templateUrl: './edit-user-profile.component.html',
    styleUrls: ['./edit-user-profile.component.css', '../../user-profile.css'],
    standalone: false
})

export class EditUserProfileComponent implements OnInit {
  public progressValue = 0;
  userData: IUserDados;
  editForm: FormGroup;
  uid!: string;
  estados: any[] = [];
  municipios: any[] = [];
  genderOptions = [
    { value: 'homem', label: 'Homem' },
    { value: 'mulher', label: 'Mulher' },
    { value: 'casal-ele-ele', label: 'Casal (Ele/Ele)' },
    { value: 'casal-ele-ela', label: 'Casal (Ele/Ela)' },
    { value: 'casal-ela-ela', label: 'Casal (Ela/Ela)' },
    { value: 'travesti', label: 'Travesti' },
    { value: 'transexual', label: 'Transexual' },
    { value: 'crossdressers', label: 'Crossdressers' },
];

  isCouple(): boolean {
    return ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(this.userData.gender ?? '');
  }

  constructor(
    private firestoreQuery: FirestoreQueryService,
    private usuarioService: UsuarioService,
    private route: ActivatedRoute,
    private router: Router,
    private formBuilder: FormBuilder,
    private storageService: StorageService

  ) {
    this.userData = {} as IUserDados; // Inicializa userData
    this.editForm = this.formBuilder.group({
      nickname: [''],
      estado: [''],
      municipio: [''],
      gender: [''],
      orientation: [''],
      partner1Orientation: [''],
      partner2Orientation: [''],
      descricao: [''],
      facebook: ['', [ValidatorService.facebookValidator()]],
      instagram: ['', [ValidatorService.instagramValidator()]],
      buupe: ['', [ValidatorService.buupeValidator()]],
      
    });
  }

  ngOnInit(): void {
    // Recuperar o UID do usuário
    this.uid = this.route.snapshot.paramMap.get('id') || '';
    this.loadEstados();
    if (this.uid) {
      this.firestoreQuery.getUser(this.uid).subscribe(async (user) => {
        if (user) {
          this.userData = user;
          if (this.userData.estado) {
            await this.onEstadoChange(this.userData.estado);
            // Verifica se o município pertence ao estado carregado
            if (!this.municipios.some(m => m.nome === this.userData.municipio)) {
              this.userData.municipio = '';
            }
        }
    }
      });
    }

    this.firestoreQuery.getUser(this.uid).subscribe((userData) => {
      if (userData) {
        // Define os valores para o formulário
        this.editForm.patchValue({
          nickname: userData.nickname,
          estado: userData.estado,
          municipio: userData.municipio,
          gender: userData.gender,
          orientation: userData.orientation,
          partner1Orientation: this.isCouple() ? userData.partner1Orientation : '',
          partner2Orientation: this.isCouple() ? userData.partner2Orientation : '',
          descricao: userData.descricao,
          facebook: userData.facebook || '',
          instagram: userData.instagram || '',
          buupe: userData.buupe || ''

        });

        this.userData = userData; // Atualiza os dados do usuário
      }
    });
  } // fim do ngOnInit

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.uploadFile(file);
    }
  }

  async uploadFile(file: File): Promise<void> {
    this.progressValue = 0; // Reinicia o progresso

    this.storageService.uploadProfileAvatar(file, this.uid, (progress: number) => {
      this.progressValue = progress;
      console.log(`Upload progress: ${this.progressValue}%`);
    }).subscribe({
      next: (imageUrl: string) => {
        this.userData = { ...this.userData, photoURL: imageUrl };
      },
      error: (error: any) => {
        console.error('Erro durante o upload da imagem:', error);
      }
    });
  }

   async loadEstados() {
    try {
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
      this.estados = await response.json();
      this.estados.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os estados

      // Se o usuário já tem um estado definido, carregue os municípios desse estado
      if (this.userData && this.userData.estado) {
        await this.onEstadoChange(this.userData.estado);
      }
    } catch (error) {
      console.error('Erro ao carregar os estados:', error);
    }
  } // fim do método loadEstados

  // src\app\user-profile\user-profile-edit\edit-user-profile\edit-user-profile.component.ts

  async onEstadoChange(estadoSigla: string) {
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${estadoSigla}/municipios`);
      this.municipios = await response.json();
      this.municipios.sort((a, b) => a.nome.localeCompare(b.nome));

      const municipioAtual = this.userData.municipio && this.municipios.find(m => m.nome === this.userData.municipio) ? this.userData.municipio : this.municipios[0].nome;
      this.editForm.patchValue({ municipio: municipioAtual });

      // Se o estado atual corresponder ao estado do perfil do usuário, tente definir seu município,
      // caso contrário, redefina a seleção de município (ou defina para o primeiro município da lista como padrão).
      if (estadoSigla === this.userData.estado && this.municipios.some(m => m.nome === this.userData.municipio)) {
        this.editForm.patchValue({
          municipio: this.userData.municipio
        });
      } else {
        this.editForm.patchValue({
          municipio: this.municipios.length > 0 ? this.municipios[0].nome : ''
        });
      }
    } catch (error) {
      console.error('Erro ao carregar os municípios:', error);
    }
  } // fim do método onEstadoChange

  onSubmit(): void {// Coleta os dados atualizados do formulário
    const instagramControl = this.editForm.get('instagram');
    console.log('Instagram Control:', instagramControl?.value, instagramControl?.valid);

    Object.keys(this.editForm.controls).forEach(key => {
      const control = this.editForm.get(key);
      console.log(key, control?.value, control?.valid);
    });
    console.log('Estado do Formulário:', this.editForm);
    if (!this.editForm.valid) {
      console.error('Formulário inválido');
      return;
    }

    const formValues = this.editForm.value;

    // Trata campos que podem não estar presentes para todos os usuários
    if (this.isCouple()) {
      // Caso seja um casal, garante que os campos partner1Orientation e partner2Orientation tenham valores
      formValues.partner1Orientation = formValues.partner1Orientation || '';
      formValues.partner2Orientation = formValues.partner2Orientation || '';
    } else {
      // Caso não seja um casal, remove os campos do objeto a ser enviado
      delete formValues.partner1Orientation;
      delete formValues.partner2Orientation;
    }

    if (formValues.descricao === undefined) {
      formValues.descricao = '';
    }

    // Define valores padrão para campos que podem estar indefinidos
    formValues.facebook = formValues.facebook || '';
    formValues.instagram = formValues.instagram || '';
    formValues.buupe = formValues.buupe || '';

    // Combina os dados atualizados do formulário com os dados existentes do usuário
    const updatedUserData = { ...this.userData, ...formValues };

    // Atualiza os dados do usuário no Firestore
    if (this.editForm.valid) {
      this.usuarioService.atualizarUsuario(this.uid, updatedUserData).subscribe(() => {
      this.router.navigate(['/perfil', this.uid]);
      }, error => {
        console.error('Erro ao atualizar os dados do usuário:', error);
      });
    }
  } // fim do método onSubmit
  } // fim do método onInit


