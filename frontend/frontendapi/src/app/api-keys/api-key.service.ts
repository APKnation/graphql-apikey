import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, switchMap, timeout } from 'rxjs';
import { APIKeyResponse, GenerateAPIKeyRequest, ListResponse, ValidationResponse } from './types';

@Injectable({
  providedIn: 'root'
})
export class APIKeyService {
  private readonly apiUrl = '/api';

  constructor(private readonly http: HttpClient) {}

  generateAPIKey(request: GenerateAPIKeyRequest): Observable<APIKeyResponse> {
    return this.getCsrfToken().pipe(
      timeout({ first: 15000 }),
      switchMap(token => this.http.post<APIKeyResponse>(
        `${this.apiUrl}/generate/`,
        request,
        { headers: new HttpHeaders({ 'X-CSRFToken': token }), timeout: 15000 }
      ))
    );
  }

  listAPIKeys(): Observable<ListResponse> {
    return this.http.get<ListResponse>(`${this.apiUrl}/list/`, { timeout: 10000 });
  }

  deleteAPIKey(keyId: string): Observable<{ success: boolean }> {
    return this.getCsrfToken().pipe(
      switchMap(token => this.http.delete<{ success: boolean }>(
        `${this.apiUrl}/delete/${keyId}/`,
        { headers: new HttpHeaders({ 'X-CSRFToken': token }) }
      ))
    );
  }

  validateAPIKey(key: string): Observable<ValidationResponse> {
    return this.http.post<ValidationResponse>(`${this.apiUrl}/validate/`, { key });
  }

  private getCsrfToken(): Observable<string> {
    return this.http.get<{ csrf_token: string }>(`${this.apiUrl}/auth/csrf/`).pipe(
      map(response => response.csrf_token),
      timeout({ first: 15000 })
    );
  }
}