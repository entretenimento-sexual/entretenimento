//src\app\chat-module\chat-module-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { authGuard } from '../core/guards/auth.guard';

const routes: Routes = [
  {
    path: ':userId',
    component: ChatModuleLayoutComponent,
    canActivate: [authGuard],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ChatModuleRoutingModule { }
