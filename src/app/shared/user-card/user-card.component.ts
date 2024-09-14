//src\app\shared\user-card\user-card.component.ts
import { Component, Input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.css']
})
export class UserCardComponent {
  @Input() user!: IUserDados | null;
  @Input() distanciaKm: number | null = null;

  ngOnChanges() {
    console.log('User:', this.user);
    console.log('Distância recebida:', this.distanciaKm);
  }
}
