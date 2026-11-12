import { Routes } from '@angular/router';
import { GenerateKeyComponent } from './api-keys/generate-key.component';
import { ListKeysComponent } from './api-keys/list-keys.component';
import { AdminDashboardComponent } from './api-keys/admin-dashboard.component';
import { ValidateKeyComponent } from './api-keys/validate-key.component';
import { LoginComponent } from './login.component';
import { authGuard, superuserGuard } from './auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'api-keys/list', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'api-keys/generate', component: GenerateKeyComponent, canActivate: [authGuard] },
  { path: 'api-keys/list', component: ListKeysComponent, canActivate: [authGuard] },
  { path: 'api-keys/admin', component: AdminDashboardComponent, canActivate: [superuserGuard] },
  { path: 'api-keys/validate', component: ValidateKeyComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '/api-keys/list' }
];
