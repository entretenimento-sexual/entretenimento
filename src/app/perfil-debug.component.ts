//src\app\perfil-debug.component.ts
import { Component, Input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-perfil-debug',
  template: `
    <main style="padding:16px">
      <h1>PERFIL DEBUG</h1>
      <p>id: <strong>{{ id }}</strong></p>
    </main>
  `
})
export class PerfilDebugComponent {
  @Input() id = '';
}
