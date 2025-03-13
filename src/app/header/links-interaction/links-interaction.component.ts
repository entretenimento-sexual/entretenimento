//src\app\header\links-interaction\links-interaction.component.ts
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';
import { NotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

@Component({
    selector: 'app-links-interaction',
    templateUrl: './links-interaction.component.html',
    styleUrls: ['./links-interaction.component.css'],
    standalone: false
})
export class LinksInteractionComponent implements OnInit {
  selectedImageFile!: File;
  userId: string | null = null;
  unreadMessagesCount: number = 0;
  pendingInvitesCount: number = 0;

  constructor(private modalService: NgbModal,
              private notificationService: NotificationService,
              private cdr: ChangeDetectorRef,
              private authService: AuthService) { }

  ngOnInit(): void {
    // Obtenha o userId do usuário autenticado
    this.authService.user$.subscribe(user => {
      if (user) {
        this.userId = user.uid; // Captura o userId do usuário
        this.notificationService.monitorUnreadMessages(user.uid); // Monitora mensagens para o usuário
      }
    });


    // Inscrever-se nas notificações de mensagens não lidas
    this.notificationService.unreadMessagesCount$.subscribe(count => {
      console.log('Contagem de mensagens não lidas recebida no componente:', count);
      this.unreadMessagesCount = count;
      this.cdr.detectChanges();
    });

// Inscrever-se nas notificações de convites pendentes
this.notificationService.pendingInvitesCount$.subscribe(count => {
  this.pendingInvitesCount = count;
  this.cdr.detectChanges();
});
  }

  onUploadPhotoClick(): void {
    const modalRef = this.modalService.open(UploadPhotoComponent, { size: 'lg' });

    modalRef.componentInstance.photoSelected.subscribe((file: File) => {
      this.selectedImageFile = file;
      this.openPhotoEditorWithFile(this.selectedImageFile);
    });
  }

  openPhotoEditorWithFile(file: File): void {
    const editorModalRef = this.modalService.open(PhotoEditorComponent, { size: 'lg' });
    editorModalRef.componentInstance.imageFile = file;
  }
}
