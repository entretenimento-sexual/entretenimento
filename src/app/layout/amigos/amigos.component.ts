// src\app\layout\amigos\amigos.component.ts
import { Component, OnInit } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserInteractionsService } from 'src/app/core/services/user-interactions.service';

@Component({
  selector: 'app-amigos',
  standalone: true,
  imports: [],
  templateUrl: './amigos.component.html',
  styleUrls: ['./amigos.component.css', '../layout-profile-exibe.css']
})

export class AmigosComponent implements OnInit {
  amigos: IUserDados[] = [];

  constructor(private userInteractionsService: UserInteractionsService) { }

  ngOnInit(): void {
    this.carregarAmigos();
  }

  private carregarAmigos(): void {
    this.userInteractionsService.loadFriends()
      .then(() => { // Removido 'amigos => this.amigos = amigos'
        // Se a promessa for resolvida, presume-se que a propriedade 'amigos' já foi atualizada no serviço
        this.amigos = this.userInteractionsService.amigos; // Atualizando 'amigos' aqui
      })
      .catch(error => console.error('Erro ao carregar amigos:', error));
  }
}
