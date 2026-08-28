//src\app\shared\components-globais\user-card\chat-user-card\chat-user-card.component.ts
import { Component, input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BaseUserCardComponent } from '../base-user-card/base-user-card.component';

@Component({
  selector: 'app-chat-user-card',
  imports: [BaseUserCardComponent],
  templateUrl: './chat-user-card.component.html',
  styleUrl: './chat-user-card.component.css'
})

export class ChatUserCardComponent {
  readonly user = input.required<IUserDados>();
  readonly lastMessage = input.required<string>();
}
