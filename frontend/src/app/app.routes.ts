import { Routes } from '@angular/router';
import { QrScannerComponent } from './features/auth/qr-scanner/qr-scanner.component';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full'
  },
  {
    path: 'auth',
    component: QrScannerComponent
  },
  {
    path: 'chats',
    loadComponent: () => import('./app').then(m => m.MainChatComponent)
  },
  {
    path: 'analytics',
    loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent)
  }
];

