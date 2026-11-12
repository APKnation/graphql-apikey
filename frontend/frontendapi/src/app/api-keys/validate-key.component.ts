import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { APIKeyService } from './api-key.service';
import { ValidationResponse } from './types';

@Component({
  selector: 'app-validate-key',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-container narrow-container">
      <header class="page-heading">
        <div>
          <p class="eyebrow">DIAGNOSTICS</p>
          <h1>Validate an API key</h1>
          <p class="page-description">Check whether a key is active and review its permissions.</p>
        </div>
      </header>

      <div *ngIf="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>

      <form class="panel form-panel" (ngSubmit)="validateKey()" #validateForm="ngForm">
        <div class="form-field">
          <label for="apiKey">API key <span class="required-mark">*</span></label>
          <input
            id="apiKey"
            name="apiKey"
            type="password"
            [(ngModel)]="apiKeyValue"
            autocomplete="off"
            spellcheck="false"
            required
            placeholder="Paste an API key"
          >
          <span class="field-help">The key is sent securely to the validation endpoint and is not stored by this page.</span>
        </div>
        <div class="form-actions">
          <button class="button button-primary" type="submit" [disabled]="validateForm.invalid || validating">
            {{ validating ? 'Checking…' : 'Validate key' }}
          </button>
        </div>
      </form>

      <section *ngIf="validationResult as result" class="panel validation-result" [ngClass]="result.valid ? 'result-valid' : 'result-invalid'" aria-live="polite">
        <div class="result-heading">
          <span class="result-icon" aria-hidden="true">{{ result.valid ? '✓' : '!' }}</span>
          <div>
            <h2>{{ result.valid ? 'Key is valid' : 'Key is not valid' }}</h2>
            <p>{{ result.valid ? 'This credential is active and can be used.' : (result.error || 'This key is invalid, inactive, or expired.') }}</p>
          </div>
        </div>
        <dl *ngIf="result.valid" class="details-list">
          <div><dt>Name</dt><dd>{{ result.name }}</dd></div>
          <div><dt>Key ID</dt><dd><code>{{ result.key_id }}</code></dd></div>
          <div><dt>Permissions</dt><dd>{{ result.scopes?.join(', ') }}</dd></div>
          <div><dt>Usage count</dt><dd>{{ result.usage_count | number }}</dd></div>
        </dl>
      </section>
    </section>
  `,
  styleUrls: ['./validate-key.component.css']
})
export class ValidateKeyComponent {
  apiKeyValue = '';
  validationResult: ValidationResponse | null = null;
  errorMessage = '';
  validating = false;
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(private readonly apiKeyService: APIKeyService) {}

  validateKey(): void {
    const key = this.apiKeyValue.trim();
    if (!key || this.validating) return;

    this.errorMessage = '';
    this.validationResult = null;
    this.validating = true;
    this.apiKeyService.validateAPIKey(key).subscribe({
      next: result => {
        this.validationResult = result;
        this.validating = false;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401 || error.status === 400) {
          this.validationResult = {
            valid: false,
            error: error.error?.error ?? 'This API key is invalid or expired.'
          };
        } else {
          this.errorMessage = error.status === 0
            ? 'Could not connect to the server. Check that the backend is running.'
            : 'The key could not be checked. Please try again.';
        }
        this.validating = false;
        this.cdr.markForCheck();
      }
    });
  }
}
