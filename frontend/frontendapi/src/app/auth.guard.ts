import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.ensureSession().pipe(
    map(user => user
      ? true
      : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })),
    catchError(() => of(router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url, sessionError: '1' }
    })))
  );
};

/** The administration page manages every key through GraphQL, so it is superuser-only. */
export const superuserGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.ensureSession().pipe(
    map(user => {
      if (!user) return router.createUrlTree(['/login']);
      return user.is_superuser ? true : router.createUrlTree(['/api-keys/list']);
    }),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { sessionError: '1' } })))
  );
};
