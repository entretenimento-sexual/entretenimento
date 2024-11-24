//src\app\chat-module\rooms\rooms-routing.module.ts
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
