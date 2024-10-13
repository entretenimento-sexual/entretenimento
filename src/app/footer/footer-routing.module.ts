// src/app/footer/footer-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TermosECondicoesComponent } from './legal-footer/termos-e-condicoes/termos-e-condicoes.component';
import { PoliticaDePrivacidadeComponent } from './legal-footer/politica-de-privacidade/politica-de-privacidade.component';

const routes: Routes = [
  { path: 'termos-e-condicoes', component: TermosECondicoesComponent },
  { path: 'politica-de-privacidade', component: PoliticaDePrivacidadeComponent },
  // Outras rotas...
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class FooterRoutingModule { }
