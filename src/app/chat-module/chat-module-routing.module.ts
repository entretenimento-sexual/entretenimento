//src\app\chat-module\chat-module-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes, CanActivate } from '@angular/router';
import { ChatListComponent } from './chat-list/chat-list.component';
import { ChatWindowComponent } from './chat-window/chat-window.component';
import { AuthGuard } from '../core/guards/auth.guard';


const routes: Routes = [
  { path: '', component: ChatListComponent, canActivate: [AuthGuard] },
  { path: 'chat/:chatId', component: ChatWindowComponent, canActivate: [AuthGuard] }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ChatModuleRoutingModule { }
