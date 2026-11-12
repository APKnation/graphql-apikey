import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { APIKeyService } from './api-key.service';
import { APIKey } from './types';

@Component({
  selector: 'app-list-keys',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-container">
      <header class="page-heading">
        <div>
          <p class="eyebrow">{{ isStaffView ? 'ADMIN WORKSPACE' : 'YOUR WORKSPACE' }}</p>
          <h1>{{ isStaffView ? 'All API keys' : 'API keys' }}</h1>
          <p class="page-description">
            {{ isStaffView
              ? 'Review keys across all accounts. Owners are shown for each credential.'
              : 'Create, review, and revoke the credentials your applications use.' }}
          </p>
        </div>
        <a class="button button-primary" routerLink="/api-keys/generate">Generate a key</a>
      </header>

      <div class="summary-row">
        <article class="summary-card">
          <span class="summary-label">Total keys</span>
          <strong>{{ apiKeys.length }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Active keys</span>
          <strong>{{ activeCount }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Total usage</span>
          <strong>{{ totalUsage | number }}</strong>
        </article>
      </div>

      <div *ngIf="errorMessage" class="notice notice-error" role="alert">
        <span>{{ errorMessage }}</span>
        <button class="text-button" type="button" (click)="loadAPIKeys()">Try again</button>
      </div>

      <div *ngIf="loading" class="panel loading-state" role="status">Loading your API keys…</div>

      <section *ngIf="!loading && !errorMessage && apiKeys.length === 0" class="panel empty-state">
        <div class="empty-icon" aria-hidden="true">⌘</div>
        <h2>No API keys yet</h2>
        <p>Create a key to connect an application to your API. You’ll be able to copy it once after creation.</p>
        <a class="button button-primary" routerLink="/api-keys/generate">Create your first key</a>
      </section>

      <section *ngIf="!loading && apiKeys.length > 0" class="panel">
        <div class="panel-heading">
          <div>
            <h2>{{ isStaffView ? 'Keys across all accounts' : 'Your keys' }}</h2>
            <p>{{ apiKeys.length }} credential{{ apiKeys.length === 1 ? '' : 's' }}</p>
          </div>
          <label class="search-control">
            <span class="visually-hidden">Search keys</span>
            <input [(ngModel)]="searchTerm" type="search" placeholder="Search keys">
          </label>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th *ngIf="isStaffView" scope="col">Owner</th>
                <th scope="col">Created</th>
                <th scope="col">Expires</th>
                <th scope="col">Usage</th>
                <th scope="col">Status</th>
                <th scope="col"><span class="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let key of filteredKeys">
                <td class="cell-title">
                  <strong class="key-name">{{ key.name }}</strong>
                  <span class="secondary-text">{{ key.description || 'No description' }}</span>
                  <span class="scope-list">{{ key.scopes.join(' · ') }}</span>
                </td>
                <td *ngIf="isStaffView" data-label="Owner">{{ key.username }}</td>
                <td data-label="Created">{{ key.created_at | date:'mediumDate' }}</td>
                <td data-label="Expires">{{ key.expires_at ? (key.expires_at | date:'mediumDate') : 'Never' }}</td>
                <td data-label="Usage">
                  <strong>{{ key.usage_count | number }}</strong>
                  <span class="secondary-text" *ngIf="key.last_used_at">Last used {{ key.last_used_at | date:'short' }}</span>
                </td>
                <td data-label="Status"><span class="status-badge" [ngClass]="statusClass(key)">{{ statusLabel(key) }}</span></td>
                <td class="action-cell">
                  <ng-container *ngIf="confirmingId === key.id; else deleteAction">
                    <span class="confirm-label">Revoke?</span>
                    <button class="text-button danger-text" type="button" [disabled]="deletingId === key.id" (click)="deleteKey(key)">
                      {{ deletingId === key.id ? 'Revoking…' : 'Confirm' }}
                    </button>
                    <button class="text-button" type="button" (click)="confirmingId = null">Cancel</button>
                  </ng-container>
                  <ng-template #deleteAction>
                    <button class="text-button danger-text" type="button" [attr.aria-label]="'Revoke ' + key.name" (click)="confirmingId = key.id">Revoke</button>
                  </ng-template>
                </td>
              </tr>
            </tbody>
          </table>
          <p *ngIf="filteredKeys.length === 0" class="no-results">No keys match “{{ searchTerm }}”.</p>
        </div>
      </section>
    </section>
  `,
  styleUrls: ['./list-keys.component.css']
})
export class ListKeysComponent implements OnInit {
  apiKeys: APIKey[] = [];
  loading = true;
  errorMessage = '';
  isStaffView = false;
  searchTerm = '';
  confirmingId: string | null = null;
  deletingId: string | null = null;
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(private readonly apiKeyService: APIKeyService) {}

  get filteredKeys(): APIKey[] {
    const query = this.searchTerm.trim().toLowerCase();
    return query
      ? this.apiKeys.filter(key => `${key.name} ${key.description} ${key.username} ${key.scopes.join(' ')}`.toLowerCase().includes(query))
      : this.apiKeys;
  }

  get activeCount(): number {
    return this.apiKeys.filter(key => this.statusLabel(key) === 'Active').length;
  }

  get totalUsage(): number {
    return this.apiKeys.reduce((total, key) => total + key.usage_count, 0);
  }

  ngOnInit(): void {
    this.loadAPIKeys();
  }

  loadAPIKeys(): void {
    this.loading = true;
    this.errorMessage = '';
    this.apiKeyService.listAPIKeys().subscribe({
      next: response => {
        this.apiKeys = response.api_keys;
        this.isStaffView = response.is_staff_view;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage = error.status === 0
          ? 'Could not connect to the server. Check that the backend is running.'
          : error.error?.error ?? 'Your API keys could not be loaded.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  deleteKey(key: APIKey): void {
    this.deletingId = key.id;
    this.errorMessage = '';
    this.apiKeyService.deleteAPIKey(key.id).subscribe({
      next: () => {
        this.apiKeys = this.apiKeys.filter(item => item.id !== key.id);
        this.confirmingId = null;
        this.deletingId = null;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage = error.error?.error ?? 'The API key could not be revoked.';
        this.deletingId = null;
        this.cdr.markForCheck();
      }
    });
  }

  statusLabel(key: APIKey): string {
    if (!key.is_active) return 'Inactive';
    if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) return 'Expired';
    return 'Active';
  }

  statusClass(key: APIKey): string {
    return `status-${this.statusLabel(key).toLowerCase()}`;
  }
}