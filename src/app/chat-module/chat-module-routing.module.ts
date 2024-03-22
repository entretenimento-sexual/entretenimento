//src\app\chat-module\chat-module-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { AuthGuard } from '../core/guards/auth.guard';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';
import { BasicGuard } from '../core/guards/basic.guard';

const routes: Routes = [
  {
    path: ':userId',
    component: ChatModuleLayoutComponent,
    canActivate: [AuthGuard],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ChatModuleRoutingModule { }
