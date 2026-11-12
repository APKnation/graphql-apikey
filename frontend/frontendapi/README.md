# API Key Manager

Angular frontend for the Django API key service. The frontend uses Django session authentication; public account registration is disabled.

## Run locally

Start the backend in one terminal:

```bash
cd backend/apikey
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 8000
```

Start the frontend in a second terminal:

```bash
cd frontend/frontendapi
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200) and sign in with an existing Django account. The Angular development server proxies `/api` requests to `http://127.0.0.1:8000`.

The admin dashboard is available to staff users. API keys are shown in full only immediately after generation.

## API endpoints

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/auth/csrf/` | Public; obtains a CSRF token |
| `POST` | `/api/auth/login/` | Public; username and password |
| `POST` | `/api/auth/logout/` | Session |
| `GET` | `/api/auth/me/` | Session |
| `POST` | `/api/generate/` | Session |
| `GET` | `/api/list/` | Session; own keys, or all keys for staff users |
| `DELETE` | `/api/delete/{key_id}/` | Session; owner or staff user |
| `POST` | `/api/validate/` | Public; JSON `{"key": "..."}` or `Authorization: Bearer ...` |
| `GET` | `/api/admin-dashboard/` | Staff session |

State-changing session requests require the `X-CSRFToken` header. The API returns JSON, including JSON errors for authentication and validation failures.

## Development checks

```bash
cd backend/apikey
python manage.py test api_keys

cd ../../frontend/frontendapi
npm test
npm run build
```
