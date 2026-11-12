import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, switchMap } from 'rxjs';

/** Shapes returned by the superuser GraphQL API at /api/graphql/ (see backend graphql_api/schema.py). */
export type KeyStatus = 'active' | 'expired' | 'inactive';

export interface GqlUser {
  id: string;
  username: string;
}

export interface GqlApiKey {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  isActive: boolean;
  status: KeyStatus;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  user: GqlUser;
}

export interface GqlAdminStats {
  totalKeys: number;
  activeKeys: number;
  expiredKeys: number;
  inactiveKeys: number;
  totalUsage: number;
}

export interface CreateKeyInput {
  name: string;
  description: string;
  scopes: string[];
  userId: string;
  expiresDays: number | null;
}

export interface UpdateKeyInput {
  name: string;
  description: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: string | null;
  userId: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string }[];
}

const KEY_FIELDS = `
  id name description scopes isActive status createdAt expiresAt lastUsedAt usageCount
  user { id username }
`;

@Injectable({ providedIn: 'root' })
export class AdminGraphqlService {
  private readonly endpoint = '/api/graphql/';

  constructor(private readonly http: HttpClient) {}

  loadDashboard(): Observable<{ adminStats: GqlAdminStats; allApiKeys: GqlApiKey[]; users: GqlUser[] }> {
    return this.request(`
      query AdminDashboard {
        adminStats { totalKeys activeKeys expiredKeys inactiveKeys totalUsage }
        allApiKeys { ${KEY_FIELDS} }
        users { id username }
      }
    `);
  }

  revealKey(id: string): Observable<string> {
    return this.request<{ revealApiKey: string }>(
      `query RevealKey($id: UUID!) { revealApiKey(id: $id) }`,
      { id }
    ).pipe(map(data => data.revealApiKey));
  }

  createKey(input: CreateKeyInput): Observable<{ apiKey: GqlApiKey; key: string }> {
    return this.request<{ createApiKey: { apiKey: GqlApiKey; key: string } }>(
      `mutation CreateKey($name: String!, $description: String, $scopes: [String!]!, $userId: ID, $expiresDays: Int) {
        createApiKey(name: $name, description: $description, scopes: $scopes, userId: $userId, expiresDays: $expiresDays) {
          key
          apiKey { ${KEY_FIELDS} }
        }
      }`,
      { ...input }
    ).pipe(map(data => data.createApiKey));
  }

  updateKey(id: string, input: UpdateKeyInput): Observable<GqlApiKey> {
    return this.request<{ updateApiKey: { apiKey: GqlApiKey } }>(
      `mutation UpdateKey($id: UUID!, $name: String, $description: String, $scopes: [String!], $isActive: Boolean, $expiresAt: DateTime, $userId: ID) {
        updateApiKey(id: $id, name: $name, description: $description, scopes: $scopes, isActive: $isActive, expiresAt: $expiresAt, userId: $userId) {
          apiKey { ${KEY_FIELDS} }
        }
      }`,
      { id, ...input }
    ).pipe(map(data => data.updateApiKey.apiKey));
  }

  deleteKey(id: string): Observable<boolean> {
    return this.request<{ deleteApiKey: { success: boolean } }>(
      `mutation DeleteKey($id: UUID!) { deleteApiKey(id: $id) { success } }`,
      { id }
    ).pipe(map(data => data.deleteApiKey.success));
  }

  /** Runs a GraphQL operation with the Django session + CSRF token; GraphQL errors become thrown Errors. */
  private request<T>(query: string, variables: Record<string, unknown> = {}): Observable<T> {
    return this.http.get<{ csrf_token: string }>('/api/auth/csrf/').pipe(
      switchMap(({ csrf_token }) => this.http.post<GraphQLResponse<T>>(
        this.endpoint,
        { query, variables },
        { headers: new HttpHeaders({ 'X-CSRFToken': csrf_token }) }
      )),
      map(response => {
        if (response.errors?.length) throw new Error(response.errors[0].message);
        if (!response.data) throw new Error('The server returned no data.');
        return response.data;
      })
    );
  }
}
