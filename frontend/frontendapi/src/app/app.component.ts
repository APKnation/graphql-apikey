import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell">
      <header class="app-header" *ngIf="auth.user$ | async as user">
        <a class="brand" routerLink="/api-keys/list" aria-label="API Key Manager home">
          <span class="brand-mark" aria-hidden="true">K</span>
          <span>Key Manager</span>
        </a>

        <nav class="primary-nav" aria-label="Main navigation">
          <a
            routerLink="/api-keys/list"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
          >API keys</a>
          <a routerLink="/api-keys/generate" routerLinkActive="active">Generate key</a>
          <a *ngIf="user.is_superuser" routerLink="/api-keys/admin" routerLinkActive="active">Administration</a>
          <a routerLink="/api-keys/validate" routerLinkActive="active">Validate key</a>
        </nav>

        <div class="account-actions">
          <span class="username">{{ user.username }}</span>
          <button type="button" class="logout-button" (click)="signOut()">Sign out</button>
        </div>
      </header>

      <div *ngIf="authError" class="auth-error" role="alert">{{ authError }}</div>

      <main class="page-content" [class.page-content-bare]="!(auth.user$ | async)">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  authError = '';
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(
    readonly auth: AuthService,
    private readonly router: Router
  ) {}

  signOut(): void {
    this.authError = '';
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => {
        this.authError = 'Could not sign out. Check the server connection and try again.';
        this.cdr.markForCheck();
      }
    });
  }
}