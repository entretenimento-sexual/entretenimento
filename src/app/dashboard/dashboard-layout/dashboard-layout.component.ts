// src/app/dashboard/dashboard-layout/dashboard-layout.component.ts
// Layout pai do dashboard.
//
// Responsabilidades nesta fase:
// - servir como container das rotas filhas do dashboard
// - renderizar apenas o router-outlet do domínio dashboard
//
// Observação arquitetural:
// - navbar, sidebar global e footer pertencem ao LayoutShellComponent
// - este componente não deve mais renderizar navegação estrutural própria
import { Component } from '@angular/core';

@Component({
  selector: 'app-dashboard-layout',
  templateUrl: './dashboard-layout.component.html',
  styleUrls: ['./dashboard-layout.component.css'],
  standalone: false
})
export class DashboardLayoutComponent {}
