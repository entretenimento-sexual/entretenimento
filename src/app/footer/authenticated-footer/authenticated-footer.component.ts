// src/app/footer/authenticated-footer/authenticated-footer.component.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-authenticated-footer',
  templateUrl: './authenticated-footer.component.html',
  styleUrl: './authenticated-footer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AuthenticatedFooterComponent {
  readonly currentYear = new Date().getFullYear();
}
