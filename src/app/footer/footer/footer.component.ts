//src\app\footer\footer\footer.component.ts
import { Component, input } from '@angular/core';

@Component({
    selector: 'app-footer',
    templateUrl: './footer.component.html',
    styleUrl: '../footer-shared.css',
    standalone: false
})
export class FooterComponent {
  readonly compact = input(false);
}
