import { Component, OnInit, computed, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminGraphqlService,
  GqlAdminStats,
  GqlApiKey,
  GqlUser,
  KeyStatus
} from './admin-graphql.service';

const SCOPES = [
  { value: 'read', label: 'Read', help: 'View data and resources' },
  { value: 'write', label: 'Write', help: 'Create and update data' },
  { value: 'admin', label: 'Admin', help: 'Administrative operations' }
];

interface KeyForm {
  name: string;
  description: string;
  scopes: string[];
  userId: string;
  isActive: boolean;
  /** Create: days until expiry (null = never). */
  expiresDays: number | null;
  /** Edit: yyyy-mm-dd from a date input ('' = never). */
  expiresDate: string;
}

/** Superuser page: every key across all accounts, managed through the GraphQL API. */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <section class="page-container">
      <header class="page-heading">
        <div>
          <h1>Administration</h1>
          <p class="page-description">View, create, edit, and delete every API key across all accounts.</p>
        </div>
        <div class="heading-actions">
          <button class="button button-secondary" type="button" (click)="load()" [disabled]="loading()">
            {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button class="button button-primary" type="button" (click)="openCreate()">New key</button>
        </div>
      </header>

      @if (errorMessage()) {
        <div class="notice notice-error" role="alert">
          <span>{{ errorMessage() }}</span>
          <button class="text-button" type="button" (click)="errorMessage.set('')">Dismiss</button>
        </div>
      }
      @if (successMessage()) {
        <div class="notice notice-success" role="status">
          <span>{{ successMessage() }}</span>
          <button class="text-button" type="button" (click)="successMessage.set('')">Dismiss</button>
        </div>
      }

      @if (createdKey(); as created) {
        <section class="notice notice-success key-created" aria-live="polite">
          <div>
            <h2>Key “{{ created.name }}” created</h2>
            <p>Copy the secret now, or reveal it later with the eye icon in the table.</p>
          </div>
          <div class="key-copy-row">
            <code>{{ created.secret }}</code>
            <button class="button button-secondary" type="button" (click)="copy(created.secret, 'new')">
              {{ copiedId() === 'new' ? 'Copied' : 'Copy key' }}
            </button>
          </div>
          <button class="text-button" type="button" (click)="createdKey.set(null)">Done</button>
        </section>
      }

      @if (stats(); as s) {
        <section class="stats-grid" aria-label="API key statistics">
          <article class="summary-card stat-card">
            <span class="summary-label">Total keys</span>
            <strong>{{ s.totalKeys | number }}</strong>
            <span class="stat-caption">Across all accounts</span>
          </article>
          <article class="summary-card stat-card">
            <span class="summary-label">Active keys</span>
            <strong>{{ s.activeKeys | number }}</strong>
            <span class="stat-caption">Currently valid</span>
          </article>
          <article class="summary-card stat-card">
            <span class="summary-label">Expired / inactive</span>
            <strong>{{ s.expiredKeys | number }} / {{ s.inactiveKeys | number }}</strong>
            <span class="stat-caption">Cannot be used</span>
          </article>
          <article class="summary-card stat-card">
            <span class="summary-label">Total usage</span>
            <strong>{{ s.totalUsage | number }}</strong>
            <span class="stat-caption">Successful validations</span>
          </article>
        </section>
      }

      @if (formMode()) {
        <form class="panel form-panel key-form" (ngSubmit)="save()" #keyForm="ngForm">
          <div class="form-title">
            <h2>{{ formMode() === 'create' ? 'New API key' : 'Edit “' + editingName() + '”' }}</h2>
            <button class="text-button" type="button" (click)="closeForm()">Close</button>
          </div>

          <div class="form-grid">
            <div class="form-field">
              <label for="adminKeyName">Key name <span class="required-mark">*</span></label>
              <input id="adminKeyName" name="name" [(ngModel)]="form.name" maxlength="100" required>
            </div>
            <div class="form-field">
              <label for="adminKeyOwner">Owner</label>
              <select id="adminKeyOwner" name="userId" [(ngModel)]="form.userId">
                @for (user of users(); track user.id) {
                  <option [value]="user.id">{{ user.username }}</option>
                }
              </select>
            </div>
          </div>

          <div class="form-field">
            <label for="adminKeyDescription">Description <span class="optional-label">Optional</span></label>
            <textarea id="adminKeyDescription" name="description" [(ngModel)]="form.description" rows="2" maxlength="500"></textarea>
          </div>

          <fieldset class="form-field scope-field">
            <legend>Permissions <span class="required-mark">*</span></legend>
            @for (scope of scopeOptions; track scope.value) {
              <label class="checkbox-option">
                <input type="checkbox" [checked]="form.scopes.includes(scope.value)" (change)="toggleScope(scope.value, $event)">
                <span><strong>{{ scope.label }}</strong><small>{{ scope.help }}</small></span>
              </label>
            }
            @if (form.scopes.length === 0) {
              <span class="field-error" role="alert">Select at least one permission.</span>
            }
          </fieldset>

          <div class="form-grid">
            @if (formMode() === 'create') {
              <div class="form-field">
                <label for="adminKeyExpiry">Expiration</label>
                <select id="adminKeyExpiry" name="expiresDays" [(ngModel)]="form.expiresDays">
                  <option [ngValue]="null">Never expires</option>
                  <option [ngValue]="7">7 days</option>
                  <option [ngValue]="30">30 days</option>
                  <option [ngValue]="90">90 days</option>
                  <option [ngValue]="365">1 year</option>
                </select>
              </div>
            } @else {
              <div class="form-field">
                <label for="adminKeyExpiresDate">Expires on</label>
                <input id="adminKeyExpiresDate" name="expiresDate" type="date" [(ngModel)]="form.expiresDate">
                <span class="field-help">Leave empty for a key that never expires.</span>
              </div>
              <label class="checkbox-option active-toggle">
                <input type="checkbox" name="isActive" [(ngModel)]="form.isActive">
                <span><strong>Active</strong><small>Inactive keys fail validation</small></span>
              </label>
            }
          </div>

          <div class="form-actions">
            <button class="button button-secondary" type="button" (click)="closeForm()">Cancel</button>
            <button class="button button-primary" type="submit" [disabled]="keyForm.invalid || form.scopes.length === 0 || saving()">
              {{ saving() ? 'Saving…' : formMode() === 'create' ? 'Create key' : 'Save changes' }}
            </button>
          </div>
        </form>
      }

      @if (loading() && !stats()) {
        <div class="panel loading-state" role="status">Loading API keys…</div>
      }

      @if (stats()) {
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>All API keys</h2>
              <p>{{ filteredKeys().length }} of {{ keys().length }} credential{{ keys().length === 1 ? '' : 's' }}</p>
            </div>
            <div class="table-filters">
              <label class="search-control">
                <span class="visually-hidden">Search keys</span>
                <input type="search" placeholder="Search name, owner, scope" [ngModel]="searchTerm()" (ngModelChange)="searchTerm.set($event)">
              </label>
              <label>
                <span class="visually-hidden">Filter by status</span>
                <select class="status-filter" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
          </div>

          @if (keys().length === 0) {
            <div class="empty-inline">No API keys have been created yet.</div>
          } @else {
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Secret</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Usage</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (key of filteredKeys(); track key.id) {
                    <tr>
                      <td class="cell-title">
                        <strong class="key-name">{{ key.name }}</strong>
                        <span class="secondary-text">{{ key.description || 'No description' }}</span>
                        <span class="scope-list">{{ key.scopes.join(' · ') }}</span>
                      </td>
                      <td data-label="Owner">
                        {{ key.user.username }}
                        <span class="secondary-text">Created {{ key.createdAt | date:'mediumDate' }}</span>
                      </td>
                      <td class="secret-cell cell-wide" data-label="Secret">
                        <div class="secret-row">
                          <code class="secret-value" [class.masked]="!revealed()[key.id]">{{ revealed()[key.id] || '••••••••••••' }}</code>
                          <button
                            class="icon-button"
                            type="button"
                            [disabled]="revealingId() === key.id"
                            [attr.aria-label]="(revealed()[key.id] ? 'Hide' : 'Show') + ' key for ' + key.name"
                            [attr.aria-pressed]="!!revealed()[key.id]"
                            [title]="revealed()[key.id] ? 'Hide key' : 'Show key'"
                            (click)="toggleReveal(key)"
                          >
                            @if (revealed()[key.id]) {
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.2 4.3M6.6 6.6A12.4 12.4 0 0 0 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>
                            } @else {
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                            }
                          </button>
                          @if (revealed()[key.id]; as secret) {
                            <button class="text-button" type="button" (click)="copy(secret, key.id)">
                              {{ copiedId() === key.id ? 'Copied' : 'Copy' }}
                            </button>
                          }
                        </div>
                      </td>
                      <td data-label="Expires">{{ key.expiresAt ? (key.expiresAt | date:'mediumDate') : 'Never' }}</td>
                      <td data-label="Usage">
                        <strong>{{ key.usageCount | number }}</strong>
                        @if (key.lastUsedAt) {
                          <span class="secondary-text">Last {{ key.lastUsedAt | date:'short' }}</span>
                        }
                      </td>
                      <td data-label="Status"><span [class]="'status-badge status-' + key.status">{{ statusLabel(key.status) }}</span></td>
                      <td class="action-cell">
                        @if (confirmingId() === key.id) {
                          <span class="confirm-label">Delete?</span>
                          <button class="text-button danger-text" type="button" [disabled]="deletingId() === key.id" (click)="remove(key)">
                            {{ deletingId() === key.id ? 'Deleting…' : 'Confirm' }}
                          </button>
                          <button class="text-button" type="button" (click)="confirmingId.set(null)">Cancel</button>
                        } @else {
                          <button class="text-button" type="button" [attr.aria-label]="'Edit ' + key.name" (click)="openEdit(key)">Edit</button>
                          <button class="text-button danger-text" type="button" [attr.aria-label]="'Delete ' + key.name" (click)="confirmingId.set(key.id)">Delete</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (filteredKeys().length === 0) {
                <p class="no-results">No keys match these filters.</p>
              }
            </div>
          }
        </section>
      }
    </section>
  `,
  styleUrls: ['./admin-dashboard.component.css']
})
export class AdminDashboardComponent implements OnInit {
  readonly scopeOptions = SCOPES;

  readonly stats = signal<GqlAdminStats | null>(null);
  readonly keys = signal<GqlApiKey[]>([]);
  readonly users = signal<GqlUser[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly searchTerm = signal('');
  readonly statusFilter = signal<'' | KeyStatus>('');
  readonly filteredKeys = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();
    return this.keys().filter(key =>
      (!status || key.status === status) &&
      (!query || `${key.name} ${key.description} ${key.user.username} ${key.scopes.join(' ')}`.toLowerCase().includes(query))
    );
  });

  /** Secrets fetched on demand with the `revealApiKey` query, keyed by key id. */
  readonly revealed = signal<Record<string, string>>({});
  readonly revealingId = signal<string | null>(null);
  readonly copiedId = signal<string | null>(null);
  readonly createdKey = signal<{ id: string; name: string; secret: string } | null>(null);

  readonly formMode = signal<'create' | 'edit' | null>(null);
  readonly saving = signal(false);
  readonly editingName = signal('');
  private editingKey: GqlApiKey | null = null;
  form: KeyForm = this.emptyForm();

  readonly confirmingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  constructor(private readonly gql: AdminGraphqlService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.gql.loadDashboard().subscribe({
      next: data => {
        this.stats.set(data.adminStats);
        this.keys.set(data.allApiKeys);
        this.users.set(data.users);
        this.loading.set(false);
      },
      error: error => {
        this.errorMessage.set(this.describe(error, 'API keys could not be loaded.'));
        this.loading.set(false);
      }
    });
  }

  toggleReveal(key: GqlApiKey): void {
    if (this.revealed()[key.id]) {
      this.revealed.update(({ [key.id]: _hidden, ...rest }) => rest);
      return;
    }
    this.revealingId.set(key.id);
    this.gql.revealKey(key.id).subscribe({
      next: secret => {
        this.revealed.update(current => ({ ...current, [key.id]: secret }));
        this.revealingId.set(null);
      },
      error: error => {
        this.errorMessage.set(this.describe(error, 'The key could not be revealed.'));
        this.revealingId.set(null);
      }
    });
  }

  async copy(secret: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      this.copiedId.set(id);
      setTimeout(() => this.copiedId() === id && this.copiedId.set(null), 2000);
    } catch {
      this.errorMessage.set('Copying is not available in this browser. Select and copy the key manually.');
    }
  }

  openCreate(): void {
    this.editingKey = null;
    this.form = this.emptyForm();
    this.formMode.set('create');
  }

  openEdit(key: GqlApiKey): void {
    this.editingKey = key;
    this.editingName.set(key.name);
    this.form = {
      name: key.name,
      description: key.description,
      scopes: [...key.scopes],
      userId: key.user.id,
      isActive: key.isActive,
      expiresDays: null,
      expiresDate: key.expiresAt ? this.toDateInput(key.expiresAt) : ''
    };
    this.confirmingId.set(null);
    this.formMode.set('edit');
  }

  closeForm(): void {
    this.formMode.set(null);
    this.editingKey = null;
  }

  toggleScope(scope: string, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    this.form.scopes = checked
      ? [...this.form.scopes, scope]
      : this.form.scopes.filter(item => item !== scope);
  }

  save(): void {
    if (this.saving() || !this.form.name.trim() || this.form.scopes.length === 0) return;
    this.errorMessage.set('');
    this.successMessage.set('');
    this.saving.set(true);

    if (this.formMode() === 'create') {
      this.gql.createKey({
        name: this.form.name.trim(),
        description: this.form.description.trim(),
        scopes: this.form.scopes,
        userId: this.form.userId,
        expiresDays: this.form.expiresDays
      }).subscribe({
        next: ({ apiKey, key }) => {
          this.createdKey.set({ id: apiKey.id, name: apiKey.name, secret: key });
          this.revealed.update(current => ({ ...current, [apiKey.id]: key }));
          this.finishSave();
        },
        error: error => this.failSave(error, 'The key could not be created.')
      });
      return;
    }

    const original = this.editingKey!;
    this.gql.updateKey(original.id, {
      name: this.form.name.trim(),
      description: this.form.description.trim(),
      scopes: this.form.scopes,
      isActive: this.form.isActive,
      userId: this.form.userId,
      expiresAt: this.expiresAtFromForm(original)
    }).subscribe({
      next: updated => {
        this.successMessage.set(`Key “${updated.name}” was updated.`);
        this.finishSave();
      },
      error: error => this.failSave(error, 'The key could not be updated.')
    });
  }

  remove(key: GqlApiKey): void {
    this.deletingId.set(key.id);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.gql.deleteKey(key.id).subscribe({
      next: () => {
        this.revealed.update(({ [key.id]: _deleted, ...rest }) => rest);
        this.confirmingId.set(null);
        this.deletingId.set(null);
        if (this.editingKey?.id === key.id) this.closeForm();
        if (this.createdKey()?.id === key.id) this.createdKey.set(null);
        this.successMessage.set(`Key “${key.name}” was deleted.`);
        this.load();
      },
      error: error => {
        this.errorMessage.set(this.describe(error, 'The key could not be deleted.'));
        this.deletingId.set(null);
      }
    });
  }

  statusLabel(status: KeyStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  private finishSave(): void {
    this.saving.set(false);
    this.closeForm();
    this.load();
  }

  private failSave(error: unknown, fallback: string): void {
    this.errorMessage.set(this.describe(error, fallback));
    this.saving.set(false);
  }

  private emptyForm(): KeyForm {
    return {
      name: '',
      description: '',
      scopes: ['read'],
      userId: this.users()[0]?.id ?? '',
      isActive: true,
      expiresDays: null,
      expiresDate: ''
    };
  }

  /** Keeps the exact original timestamp when the date was not changed; otherwise expires at end of that day. */
  private expiresAtFromForm(original: GqlApiKey): string | null {
    if (!this.form.expiresDate) return null;
    if (original.expiresAt && this.toDateInput(original.expiresAt) === this.form.expiresDate) {
      return original.expiresAt;
    }
    return new Date(`${this.form.expiresDate}T23:59:59`).toISOString();
  }

  private toDateInput(iso: string): string {
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private describe(error: unknown, fallback: string): string {
    const status = (error as { status?: number })?.status;
    if (status === 0) return 'Could not connect to the server. Check that the backend is running.';
    if (status === 403) return 'Your session expired or you lack permission. Sign in again.';
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
