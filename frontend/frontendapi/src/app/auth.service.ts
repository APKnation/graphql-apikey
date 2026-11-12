import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, finalize, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';

export interface AuthUser {
  id: string;
  username: string;
  is_staff: boolean;
  is_superuser: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = '/api/auth';
  private readonly userSubject = new BehaviorSubject<AuthUser | null>(null);
  private checkedSession = false;
  private sessionRequest?: Observable<AuthUser | null>;

  readonly user$ = this.userSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  get user(): AuthUser | null {
    return this.userSubject.value;
  }

  ensureSession(): Observable<AuthUser | null> {
    if (this.checkedSession) {
      return of(this.userSubject.value);
    }
    if (this.sessionRequest) {
      return this.sessionRequest;
    }

    this.sessionRequest = this.http.get<AuthUser>(`${this.apiUrl}/me/`).pipe(
      tap(user => {
        this.userSubject.next(user);
        this.checkedSession = true;
      }),
      catchError(error => {
        if (error.status === 401) {
          this.userSubject.next(null);
          this.checkedSession = true;
          return of(null);
        }
        return throwError(() => error);
      }),
      finalize(() => {
        this.sessionRequest = undefined;
      }),
      shareReplay(1)
    );
    return this.sessionRequest;
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.getCsrfToken().pipe(
      switchMap(token => this.http.post<AuthUser>(
        `${this.apiUrl}/login/`,
        { username, password },
        { headers: new HttpHeaders({ 'X-CSRFToken': token }) }
      )),
      tap(user => {
        this.userSubject.next(user);
        this.checkedSession = true;
      })
    );
  }

  logout(): Observable<{ success: boolean }> {
    return this.getCsrfToken().pipe(
      switchMap(token => this.http.post<{ success: boolean }>(
        `${this.apiUrl}/logout/`,
        {},
        { headers: new HttpHeaders({ 'X-CSRFToken': token }) }
      )),
      tap(() => {
        this.userSubject.next(null);
        this.checkedSession = true;
      })
    );
  }

  private getCsrfToken(): Observable<string> {
    return this.http.get<{ csrf_token: string }>(`${this.apiUrl}/csrf/`).pipe(
      map(response => response.csrf_token)
    );
  }
}
