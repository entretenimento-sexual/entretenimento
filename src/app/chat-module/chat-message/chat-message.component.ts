// src\app\chat-module\chat-message\chat-message.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Subject } from 'rxjs';
import { takeUntil, switchMap, catchError } from 'rxjs/operators';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

@Component({
    selector: 'app-chat-message',
    templateUrl: './chat-message.component.html',
    styleUrls: ['./chat-message.component.css'],
    standalone: false
})
export class ChatMessageComponent implements OnInit, OnDestroy {
  @Input() message!: Message;
  @Input() chatId?: string;
  senderName: string = 'Usuário desconhecido'; // Default para nome desconhecido
  currentUserUid: string | undefined;
  private destroy$ = new Subject<void>(); // Para controle de subscrições

  constructor(
              private firestoreUserQuery: FirestoreUserQueryService,
              private authService: AuthService,
              private chatService: ChatService,) { }

  ngOnInit(): void {
    // Subscrição no estado do usuário autenticado
    this.authService.user$
      .pipe(
        takeUntil(this.destroy$), // Limpar subscrições quando o componente for destruído
        switchMap(currentUser => {
          this.currentUserUid = currentUser?.uid;
          if (this.message.senderId) {
            // Carrega os dados do usuário remetente da mensagem
            return this.firestoreUserQuery.getUser(this.message.senderId);
          } else {
            // Retorna um valor vazio se não houver senderId
            return [];
          }
        }),
        catchError(error => {
          console.error("Erro ao buscar nome do usuário", error);
          return []; // Retorna um array vazio para evitar erro no fluxo de dados
        })
      )
      .subscribe(userData => {
        // Verifica se o nickname está disponível
        this.senderName = userData?.nickname ?? 'Usuário desconhecido';
      });
  }

  // Verifica se a mensagem foi enviada pelo usuário atual
  isMessageSent(): boolean {
    return this.message.senderId === this.currentUserUid;
  }

  // Método chamado ao clicar no ícone de lixeira
  async deleteThisMessage(): Promise<void> {
    if (!this.chatId || !this.message.id) return;
    try {
      await this.chatService.deleteMessage(this.chatId, this.message.id);
      console.log('Mensagem excluída com sucesso!');
    } catch (error) {
      console.error('Erro ao excluir mensagem:', error);
    }
  }

  // Método de ciclo de vida para limpar subscrições
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getStatusText(): string {
    switch (this.message.status) {
      case 'sent':
        return 'Enviada';
      case 'delivered':
        return 'Entregue';
      case 'read':
        return 'Lida';
      default:
        return '';
    }
  }
}
