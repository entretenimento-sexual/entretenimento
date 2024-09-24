// src\app\chat-module\chat-message\chat-message.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { Subject } from 'rxjs';
import { takeUntil, switchMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-chat-message',
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css']
})
export class ChatMessageComponent implements OnInit, OnDestroy {
  @Input() message!: Message;
  senderName: string = 'Usuário desconhecido'; // Default para nome desconhecido
  currentUserUid: string | undefined;
  private destroy$ = new Subject<void>(); // Para controle de subscrições

  constructor(
    private usuarioService: UsuarioService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    // Subscrição no estado do usuário autenticado
    this.authService.getUserAuthenticated()
      .pipe(
        takeUntil(this.destroy$), // Limpar subscrições quando o componente for destruído
        switchMap(currentUser => {
          this.currentUserUid = currentUser?.uid;
          if (this.message.senderId) {
            // Carrega os dados do usuário remetente da mensagem
            return this.usuarioService.getUsuario(this.message.senderId);
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

  // Método de ciclo de vida para limpar subscrições
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
