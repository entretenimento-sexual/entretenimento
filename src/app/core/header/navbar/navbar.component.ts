// src\app\core\header\navbar\navbar.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/autentication/auth.service';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent implements OnInit {
  userId: string | null = null;

  constructor(private authService: AuthService) { }

  async ngOnInit(): Promise<void> {
    this.userId = await this.authService.getUserId();
  }
}
