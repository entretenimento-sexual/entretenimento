//src\app\shared\components-globais\user-card\chat-user-card\chat-user-card.component.ts
import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BaseUserCardComponent } from '../base-user-card/base-user-card.component';

@Component({
  selector: 'app-chat-user-card',
  imports: [CommonModule, BaseUserCardComponent],
  templateUrl: './chat-user-card.component.html',
  styleUrl: './chat-user-card.component.css'
})

export class ChatUserCardComponent {
  @Input() user!: IUserDados;
  @Input() lastMessage!: string;
}
