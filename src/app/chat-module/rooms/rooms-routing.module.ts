// src/app/chat-module/rooms/rooms-routing.module.ts
// Rotas das salas.
//
// Se este módulo estiver montado dentro de uma rota pai já protegida
// (por exemplo /chat/rooms), não precisa repetir guards aqui.

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RoomListComponent } from './room-list/room-list.component';
import { RoomDetailsComponent } from './room-details/room-details.component';
import { RoomCreationComponent } from './room-creation/room-creation.component';

const routes: Routes = [
  { path: '', component: RoomListComponent },
  { path: 'create', component: RoomCreationComponent },
  { path: ':id', component: RoomDetailsComponent },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RoomsRoutingModule { }
