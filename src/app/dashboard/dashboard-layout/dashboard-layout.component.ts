//src\app\dashboard\dashboard-layout\dashboard-layout.component.ts
// Não há muito o que mostrar aqui, mas este componente é o layout geral do dashboard (rota pai). Ele é responsável por renderizar o menu lateral e o router-outlet para as rotas filhas do dashboard (ex.: home, users, settings).
// O conteúdo específico de cada página do dashboard é renderizado nas rotas filhas, não aqui.
import { Component } from '@angular/core';

@Component({
    selector: 'app-dashboard-layout',
    templateUrl: './dashboard-layout.component.html',
    styleUrls: ['./dashboard-layout.component.css'],
    standalone: false
})
export class DashboardLayoutComponent { }
