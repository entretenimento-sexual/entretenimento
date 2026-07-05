import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DiscoveryModeTabsComponent } from './discovery-mode-tabs.component';
import { DiscoveryModeTab } from '../models/discovery-mode.model';

describe('DiscoveryModeTabsComponent', () => {
  let component: DiscoveryModeTabsComponent;
  let fixture: ComponentFixture<DiscoveryModeTabsComponent>;

  const tabs: readonly DiscoveryModeTab[] = [
    {
      id: 'todos',
      label: 'Todos',
      description: 'Todos os perfis',
    },
    {
      id: 'online',
      label: 'Online',
      description: 'Perfis online',
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscoveryModeTabsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DiscoveryModeTabsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('activeMode', 'todos');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
