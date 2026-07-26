// src/app/footer/footer-routing.module.ts
// Rotas legais públicas do rodapé.
// Devem permanecer públicas, sem autenticação.
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: 'termos',
    redirectTo: 'termos-e-condicoes',
    pathMatch: 'full',
  },
  {
    path: 'termos-e-condicoes',
    loadComponent: () =>
      import('./legal-footer/termos-e-condicoes/termos-e-condicoes.component')
        .then((m) => m.TermosECondicoesComponent),
  },
  {
    path: 'politica-de-privacidade',
    loadComponent: () =>
      import('./legal-footer/politica-de-privacidade/politica-de-privacidade.component')
        .then((m) => m.PoliticaDePrivacidadeComponent),
  },
  {
    path: 'politica-de-cookies',
    loadComponent: () =>
      import('./legal-footer/politica-de-cookies/politica-de-cookies.component')
        .then((m) => m.PoliticaDeCookiesComponent),
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FooterRoutingModule {}
