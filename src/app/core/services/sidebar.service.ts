// src/app/core/services/sidebar.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SidebarService {

  private _isSidebarVisible: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public readonly isSidebarVisible$ = this._isSidebarVisible.asObservable();

  constructor() { }

  toggleSidebar(): void {
    console.log("Toggle sidebar chamado! Valor atual:", this._isSidebarVisible.value);
    this._isSidebarVisible.next(!this._isSidebarVisible.value);
    console.log("Valor após o toggle:", this._isSidebarVisible.value);
  }

  showSidebar(): void {
    this._isSidebarVisible.next(true);
  }

  hideSidebar(): void {
    this._isSidebarVisible.next(false);
  }
}
