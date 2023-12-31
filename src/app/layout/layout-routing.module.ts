// src/app/layout/layout-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PerfisProximosComponent } from './perfis-proximos/perfis-proximos.component';

const routes: Routes = [
  { path: 'perfis-proximos', component: PerfisProximosComponent },
  // outras rotas do LayoutModule
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LayoutRoutingModule { }
