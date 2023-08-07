// src\app\core\header\user-icon\user-icon.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/autentication/auth.service';

@Component({
  selector: 'app-user-icon',
  templateUrl: './user-icon.component.html',
  styleUrls: ['./user-icon.component.css']
})
export class UserIconComponent implements OnInit {
  userProfile: any;

  constructor(public authService: AuthService) { }

  ngOnInit(): void {
    this.setUserProfile();
  }

  setUserProfile(): void {
    if (this.authService.isLoggedIn()) {
      this.userProfile = this.authService.getUserProfile();
    } else {
      this.userProfile = null;
    }
  }

  logout(): void {
    this.authService.logout();
    this.setUserProfile();  // Atualiza o userProfile após o logout
  }
}
