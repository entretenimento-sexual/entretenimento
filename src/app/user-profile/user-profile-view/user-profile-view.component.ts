// src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit } from '@angular/core';
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { environment } from '../../../environments/environment';

const db = getFirestore();

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})
export class UserProfileViewComponent implements OnInit {
  dados: any[] = [];

  async ngOnInit() {
    try {
      const querySnapshot = await getDocs(collection(db, "minhaColecao"));
      this.dados = querySnapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error("Erro ao ler dados:", error);
    }
  }
}
