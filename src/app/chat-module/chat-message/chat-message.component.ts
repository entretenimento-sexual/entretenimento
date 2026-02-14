// src\app\chat-module\chat-message\chat-message.component.ts
// Não esqueça os comentários explicativos .
//  - Este componente é responsável por exibir uma única mensagem de chat, incluindo o nome do remetente, o conteúdo da mensagem e o status (enviada, entregue, lida).
//  - Ele também permite que o usuário exclua a mensagem, se for o remetente.
//  - O componente utiliza serviços para obter informações do usuário e gerenciar mensagens de chat, e implementa boas práticas de gerenciamento de subscrições para evitar vazamentos de memória.
import { Component, OnInit, OnDestroy, input } from '@angular/core';
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
  readonly message = input.required<Message>();
  readonly chatId = input<string>();
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

          const message = this.message();
          if (message.senderId) {
            // Carrega os dados do usuário remetente da mensagem
            return this.firestoreUserQuery.getUser(message.senderId);
          } else {
            // Retorna um valor vazio se não houver senderId
            return [];
          }
        }),
        catchError(error => {
          console.log("Erro ao buscar nome do usuário", error);
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
    return this.message().senderId === this.currentUserUid;
  }

  // Método chamado ao clicar no ícone de lixeira
  // -> Substituímos 'async/await' por uso de Observables + subscribe()
  deleteThisMessage(): void {

    const message = this.message();
    const chatId = this.chatId();
    if (!chatId || !message.id) return;

    this.chatService
      .deleteMessage(chatId, message.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          console.log('Mensagem excluída com sucesso!');
        },
        error: (error) => {
          console.log('Erro ao excluir mensagem:', error);
        },
      });
  }

  // Método de ciclo de vida para limpar subscrições
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getStatusText(): string {
    switch (this.message().status) {
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
/*
auth.service.ts está sendo descuntinuado.
C:.
│   auth.service.ts
│   email-input-modal.service.ts
│   login.service.spec.ts
│   login.service.ts
│   social-auth.service.spec.ts
│   social-auth.service.ts
│
├───auth
│       access-control.service.ts
│       auth-app-block.service.ts
│       auth-orchestrator.service.ts
│       auth-return-url.service.ts
│       auth-session.service.ts
│       auth.facade.ts
│       auth.types.ts
│       current-user-store.service.ts
│       logout.service.ts
│
└───register
        email-verification.service.md
        email-verification.service.ts
        pre-register.service.ts
        register.service.spec.ts
        register.service.ts
        registerServiceREADME.md

PS C:\entretenimento\src\app\core\services\autentication>
*/
