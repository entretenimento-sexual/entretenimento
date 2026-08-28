//src\app\shared\components-globais\user-card\base-user-card\base-user-card.component.ts
import { Component, input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-base-user-card',
  imports: [],
  templateUrl: './base-user-card.component.html',
  styleUrl: './base-user-card.component.css'
})
export class BaseUserCardComponent {
  readonly user = input.required<IUserDados>();
}
