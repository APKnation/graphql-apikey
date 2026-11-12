import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-page">
      <aside class="brand-panel" aria-hidden="true">
        <div class="brand">
          <span class="brand-mark">K</span>
          <span>Key Manager</span>
        </div>
        <div class="brand-copy">
          <h2>Every API key, in one secure place.</h2>
          <ul>
            <li>Generate keys with only the permissions they need</li>
            <li>Track usage and expiry at a glance</li>
            <li>Revoke access instantly when something changes</li>
          </ul>
        </div>
        <p class="brand-foot">Protected by session authentication and CSRF checks.</p>
      </aside>

      <section class="form-panel" aria-label="Sign in">
        <div class="form-wrap">
          <div class="brand brand-compact">
            <span class="brand-mark">K</span>
            <span>Key Manager</span>
          </div>

          <h1>Sign in</h1>
          <p class="intro">Use the account your administrator gave you.</p>

          @if (errorMessage()) {
            <div class="alert" role="alert">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>
              <span>{{ errorMessage() }}</span>
            </div>
          }

          <form (ngSubmit)="signIn()" #loginForm="ngForm" novalidate>
            <div class="field">
              <label for="username">Username</label>
              <input
                id="username"
                name="username"
                [(ngModel)]="username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                required
                autofocus
              >
            </div>

            <div class="field">
              <label for="password">Password</label>
              <div class="password-box">
                <input
                  id="password"
                  name="password"
                  [type]="showPassword() ? 'text' : 'password'"
                  [(ngModel)]="password"
                  autocomplete="current-password"
                  required
                  (keyup)="checkCapsLock($event)"
                  (keydown)="checkCapsLock($event)"
                >
                <button
                  type="button"
                  class="reveal"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                  [attr.aria-pressed]="showPassword()"
                  (click)="showPassword.set(!showPassword())"
                >
                  @if (showPassword()) {
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.2 4.3M6.6 6.6A12.4 12.4 0 0 0 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>
                  } @else {
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              @if (capsLockOn()) {
                <p class="hint" role="status">Caps Lock is on.</p>
              }
            </div>

            <button class="submit" type="submit" [disabled]="loginForm.invalid || submitting()">
              @if (submitting()) {
                <span class="spinner" aria-hidden="true"></span>
                Signing in…
              } @else {
                Sign in
              }
            </button>
          </form>

          <p class="footnote">No account? Ask your administrator. Public sign-up is disabled.</p>
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  readonly errorMessage = signal('');
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly capsLockOn = signal(false);

  constructor(
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.has('sessionError')) {
      this.errorMessage.set('Could not verify your session. Check the backend connection and try again.');
    }
    this.auth.ensureSession().subscribe({
      next: user => {
        if (user) void this.router.navigateByUrl('/api-keys/list');
      },
      error: () => this.errorMessage.set('Could not connect to the server. Check that the backend is running.')
    });
  }

  checkCapsLock(event: KeyboardEvent): void {
    this.capsLockOn.set(event.getModifierState?.('CapsLock') ?? false);
  }

  signIn(): void {
    if (this.submitting() || !this.username.trim() || !this.password) return;
    this.errorMessage.set('');
    this.submitting.set(true);

    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const destination = returnUrl?.startsWith('/') && !returnUrl.startsWith('//')
          ? returnUrl
          : '/api-keys/list';
        void this.router.navigateByUrl(destination);
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.status === 0
          ? 'Could not reach the server. Check that the backend is running and try again.'
          : error.error?.error ?? 'Sign-in failed. Please try again.');
        this.password = '';
        this.submitting.set(false);
      }
    });
  }
}
