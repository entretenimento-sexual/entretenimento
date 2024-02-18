//src\app\user-profile\user-profile-view\user-photo-gallery\user-photo-gallery.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { PhotoService } from 'src/app/core/services/photo/photo.service';
import { FotoPreviewModalComponent } from 'src/app/shared/components-globais/foto-preview-modal/foto-preview-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { ImageProcessingService } from 'src/app/core/services/photo/image-processing.service';

@Component({
  selector: 'app-user-photo-gallery',
  templateUrl: './user-photo-gallery.component.html',
  styleUrls: ['./user-photo-gallery.component.css']
})

export class UserPhotoGalleryComponent implements OnInit {
  fotos: any[] = [];
  totalFotos: number = 0;
  arquivoSelecionado: File | null = null;
  urlPreVisualizacao: string | ArrayBuffer | null = null;
  mostrarModalPreVisualizacao: boolean = false;
  progress: number = 0;

  constructor(private dialog: MatDialog,
              private photoService: PhotoService,
              private authService: AuthService,
              private imageProcessingService: ImageProcessingService) { }

  ngOnInit(): void {
    this.carregarFotos();
  }

  carregarFotos(): void {
    const uid = this.authService.currentUser?.uid; // Garanta que este UID está disponível
    if (uid) {
      this.photoService.getFotosDoUsuario(uid).subscribe(fotos => {
        this.fotos = fotos;
        this.totalFotos = fotos.length;
      }, error => {
        console.error('Erro ao carregar fotos:', error);
      });
    }
  }

  enviarFoto(file: File, descricao: string): void {
    const uid = this.authService.currentUser?.uid;
    if (uid && file) {
      const timestamp = new Date().getTime();
      const nomeDoArquivo = `${timestamp}-${file.name}`;
      const filePath = `avatares/${uid}/galeria/${nomeDoArquivo}`;

      this.photoService.uploadFoto(file, filePath, descricao, uid).subscribe({
          next: (result) => {
            if (typeof result === 'number') {
              this.progress = result;
              console.log(`Progresso: ${result}%`); // Atualize o progresso aqui
            } else {
              this.progress = 0;
              this.carregarFotos();
              // Atualize a interface após o upload ser concluído
            }
          },
      error: (error) => {
        console.error('Erro ao fazer upload da foto:', error);
      },
      complete: () => this.progress = 0 // Reseta o progresso
    });
  }
}

reduzirTamanhoImagem(file: File, maxWidth: number = 800, maxHeight: number = 600): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Falha ao converter imagem para Blob.'));
          }
        }, 'image/jpeg');
      };
      img.onerror = reject;
    });
  }

  handleFileInput(event: any): void {
    const file: File = event.target.files[0];
    if (this.validarArquivo(file)) {
      this.reduzirTamanhoImagem(file).then(blob => {
        const reducedImageFile = new File([blob], file.name, { type: 'image/jpeg' });
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.urlPreVisualizacao = e.target.result;
          // Abre o modal aqui com a imagem reduzida
          const dialogRef = this.dialog.open(FotoPreviewModalComponent, {
            width: '500px',
            maxHeight: '80vh',
            data: { fotoUrl: this.urlPreVisualizacao, file: reducedImageFile }
          });

          dialogRef.afterClosed().subscribe(result => {
            if (result?.action === 'salvar' && result.file) {
              const descricao = result.descricao || "Sem descrição";
              this.enviarFoto(result.file, descricao);
            } else if (result === 'excluir') {
              this.arquivoSelecionado = null;
              this.urlPreVisualizacao = null;
            }
          });
        };
        reader.readAsDataURL(reducedImageFile);
      }).catch(error => console.error('Erro ao reduzir tamanho da imagem:', error));
    }
    event.target.value = '';
  }


  validarArquivo(file: File): boolean {
    const maxTamanho = 5 * 1024 * 1024; // 5MB, por exemplo
    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/jpg', 'image/bmp', 'image/gif',
    'image/tiff'];

    if (file.size > maxTamanho) {
      alert('O arquivo deve ser menor que 5MB.');
      return false;
    }

    if (!tiposPermitidos.includes(file.type)) {
      alert('Somente são permitidos arquivos JPEG e PNG.');
      return false;
    }
    return true;
  }

  fecharModalPreVisualizacao(): void {
    this.mostrarModalPreVisualizacao = false;
  }

  // Simulação da funcionalidade de edição
  editarFoto(): void {
    // Implemente a lógica de edição aqui
    alert('Editar foto não implementado');
  }
}
