import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError, finalize } from 'rxjs';
import { APIKeyService } from './api-key.service';
import { APIKey, GenerateAPIKeyRequest } from './types';

@Component({
  selector: 'app-generate-key',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-container narrow-container">
      <header class="page-heading">
        <div>
          <p class="eyebrow">CREDENTIALS</p>
          <h1>Generate an API key</h1>
          <p class="page-description">Give your key a clear name and only the permissions it needs.</p>
        </div>
      </header>

      <div *ngIf="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>

      <section *ngIf="generatedKey as key" class="notice notice-success key-created" aria-live="polite">
        <div>
          <h2>{{ keyVerified ? 'Key created and saved' : 'Your key is ready' }}</h2>
          <p>Copy and store it now. For your security, the full key will not be shown again.</p>
          <p *ngIf="verifyingKey" role="status">Confirming the key appears in your API key list…</p>
          <p *ngIf="keyVerified">The new key is visible in your API key list.</p>
          <p *ngIf="verificationError" class="field-error" role="status">{{ verificationError }}</p>
        </div>
        <div class="key-copy-row">
          <code>{{ key.key }}</code>
          <button class="button button-secondary" type="button" (click)="copyKey(key.key!)">
            {{ copied ? 'Copied' : 'Copy key' }}
          </button>
        </div>
        <a routerLink="/api-keys/list" class="text-link">Go to your API keys</a>
      </section>

      <form class="panel form-panel" (ngSubmit)="generateKey()" #keyForm="ngForm">
        <div class="form-field">
          <label for="keyName">Key name <span class="required-mark">*</span></label>
          <input
            id="keyName"
            name="name"
            [(ngModel)]="keyData.name"
            maxlength="100"
            placeholder="e.g. Production website"
            required
          >
          <span class="field-help">Choose a name that helps you recognize where this key is used.</span>
        </div>

        <div class="form-field">
          <label for="description">Description <span class="optional-label">Optional</span></label>
          <textarea
            id="description"
            name="description"
            [(ngModel)]="keyData.description"
            rows="3"
            maxlength="500"
            placeholder="What will this key be used for?"
          ></textarea>
        </div>

        <fieldset class="form-field scope-field">
          <legend>Permissions <span class="required-mark">*</span></legend>
          <p class="field-help">Select the minimum permissions this key needs.</p>
          <label class="checkbox-option">
            <input type="checkbox" [checked]="keyData.scopes.includes('read')" (change)="toggleScope('read', $event)">
            <span><strong>Read</strong><small>View data and resources</small></span>
          </label>
          <label class="checkbox-option">
            <input type="checkbox" [checked]="keyData.scopes.includes('write')" (change)="toggleScope('write', $event)">
            <span><strong>Write</strong><small>Create and update data</small></span>
          </label>
          <label class="checkbox-option">
            <input type="checkbox" [checked]="keyData.scopes.includes('admin')" (change)="toggleScope('admin', $event)">
            <span><strong>Admin</strong><small>Administrative operations</small></span>
          </label>
          <span *ngIf="keyData.scopes.length === 0" class="field-error" role="alert">Select at least one permission.</span>
        </fieldset>

        <div class="form-field">
          <label for="expiry">Expiration</label>
          <select id="expiry" name="expires_days" [(ngModel)]="keyData.expires_days">
            <option [ngValue]="undefined">Never expires</option>
            <option [ngValue]="7">7 days</option>
            <option [ngValue]="30">30 days</option>
            <option [ngValue]="90">90 days</option>
            <option [ngValue]="365">1 year</option>
          </select>
          <span class="field-help">Keys that expire reduce the impact of accidental exposure.</span>
        </div>

        <div class="form-actions">
          <a class="button button-secondary" routerLink="/api-keys/list">Cancel</a>
          <button class="button button-primary" type="submit" [disabled]="keyForm.invalid || keyData.scopes.length === 0 || submitting">
            {{ submitting ? 'Generating…' : 'Generate key' }}
          </button>
        </div>
      </form>
    </section>
  `,
  styleUrls: ['./generate-key.component.css']
})
export class GenerateKeyComponent {
  keyData: GenerateAPIKeyRequest = {
    name: '',
    description: '',
    scopes: ['read']
  };
  generatedKey: (APIKey & { key: string }) | null = null;
  errorMessage = '';
  submitting = false;
  copied = false;
  verifyingKey = false;
  keyVerified = false;
  verificationError = '';
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(private readonly apiKeyService: APIKeyService) {}

  toggleScope(scope: string, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    this.keyData.scopes = checked
      ? [...this.keyData.scopes, scope]
      : this.keyData.scopes.filter(item => item !== scope);
  }

  generateKey(): void {
    if (this.submitting || !this.keyData.name.trim() || this.keyData.scopes.length === 0) return;
    this.errorMessage = '';
    this.generatedKey = null;
    this.copied = false;
    this.keyVerified = false;
    this.verificationError = '';
    this.submitting = true;
    this.apiKeyService.generateAPIKey({
      ...this.keyData,
      name: this.keyData.name.trim(),
      description: this.keyData.description.trim()
    }).pipe(
      finalize(() => {
        this.submitting = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: response => {
        this.submitting = false;
        this.generatedKey = response.api_key;
        this.cdr.markForCheck();
        this.verifyKeySaved(response.api_key.id);
      },
      error: (error: HttpErrorResponse) => {
        this.submitting = false;
        this.errorMessage = error instanceof TimeoutError
          ? 'The server did not confirm the result in time. Check your API key list before retrying to avoid creating a duplicate.'
          : error.status === 0
          ? 'No response was received. The key may still have been created; check your API key list before retrying.'
          : error.error?.error ?? 'The API key could not be generated.';
        this.cdr.markForCheck();
      }
    });
  }

  private verifyKeySaved(keyId: string): void {
    this.verifyingKey = true;
    this.apiKeyService.listAPIKeys().subscribe({
      next: response => {
        this.keyVerified = response.api_keys.some(key => key.id === keyId);
        this.verificationError = this.keyVerified
          ? ''
          : 'The API replied successfully, but the key was not found in your list. Refresh the list or contact support.';
        this.verifyingKey = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.verifyingKey = false;
        this.verificationError = 'The key was created, but its appearance in your list could not be verified. Open API keys to check.';
        this.cdr.markForCheck();
      }
    });
  }

  async copyKey(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.copied = true;
    } catch {
      this.errorMessage = 'Copying is not available in this browser. Select and copy the key manually.';
    }
    this.cdr.markForCheck();
  }
}
