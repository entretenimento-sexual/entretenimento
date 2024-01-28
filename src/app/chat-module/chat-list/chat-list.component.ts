//src\app\chat-module\chat-list\chat-list.component.ts
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { Chat } from 'src/app/core/interfaces/chat.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/chat.service';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css']
})
export class ChatListComponent implements OnInit {
  chats: Chat[] = [];
  @Output() chatSelected = new EventEmitter<string>();

  constructor(private authService: AuthService,
              private chatService: ChatService,
              private router: Router) { }

  ngOnInit() {
    if (this.authService.isUserAuthenticated()) {
      const currentUser = this.authService.currentUser;
      if (currentUser?.uid) {
        this.chatService.getChats(currentUser.uid).subscribe(chats => {
          this.chats = chats;
        });
      }
    } else {
      this.router.navigate(['/login']);
    }

  }

  selectChat(chatId: string | undefined) {
    this.chatSelected.emit(chatId);
  }
}
