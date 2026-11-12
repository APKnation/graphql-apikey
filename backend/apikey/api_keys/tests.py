"""Contract tests: the JSON shapes here must match frontend/frontendapi/src/app/api-keys/types.ts."""
import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from .models import APIKey

API_KEY_FIELDS = {
    'id', 'name', 'description', 'user_id', 'username', 'scopes', 'is_active',
    'created_at', 'expires_at', 'last_used_at', 'usage_count',
}


class FrontendContractTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user('alice', password='s3cret-pass')
        self.staff = User.objects.create_user('boss', password='s3cret-pass', is_staff=True)
        # Enforce CSRF exactly like the browser + Angular frontend do.
        self.client = Client(enforce_csrf_checks=True)

    def _csrf(self):
        response = self.client.get('/api/auth/csrf/')
        self.assertEqual(response.status_code, 200)
        return response.json()['csrf_token']

    def _post(self, url, data, csrf=True):
        headers = {'HTTP_X_CSRFTOKEN': self._csrf()} if csrf else {}
        return self.client.post(url, json.dumps(data), content_type='application/json', **headers)

    def _login(self, username):
        response = self._post('/api/auth/login/', {'username': username, 'password': 's3cret-pass'})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_auth_flow(self):
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        user = self._login('alice')
        self.assertEqual(set(user), {'id', 'username', 'is_staff', 'is_superuser'})
        self.assertEqual(self.client.get('/api/auth/me/').json()['username'], 'alice')
        self.assertEqual(self._post('/api/auth/logout/', {}).json(), {'success': True})
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_bad_login_returns_error_message(self):
        response = self._post('/api/auth/login/', {'username': 'alice', 'password': 'wrong'})
        self.assertEqual(response.status_code, 401)
        self.assertIn('error', response.json())

    def test_generate_list_validate_delete(self):
        self._login('alice')
        response = self._post('/api/generate/', {
            'name': 'Website', 'description': 'prod', 'scopes': ['read', 'write'], 'expires_days': 30,
        })
        self.assertEqual(response.status_code, 201)
        created = response.json()['api_key']
        self.assertEqual(set(created), API_KEY_FIELDS | {'key'})

        listing = self.client.get('/api/list/').json()
        self.assertEqual(set(listing), {'api_keys', 'total', 'is_staff_view'})
        self.assertEqual(listing['total'], 1)
        self.assertFalse(listing['is_staff_view'])
        self.assertEqual(set(listing['api_keys'][0]), API_KEY_FIELDS)  # secret key never listed

        # The validate page posts {key} without a CSRF header.
        result = self._post('/api/validate/', {'key': created['key']}, csrf=False)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(
            set(result.json()), {'valid', 'key_id', 'name', 'user_id', 'scopes', 'usage_count'}
        )
        self.assertEqual(result.json()['usage_count'], 1)

        bad = self._post('/api/validate/', {'key': 'nope'}, csrf=False)
        self.assertEqual(bad.status_code, 401)
        self.assertEqual(bad.json()['valid'], False)

        token = self._csrf()
        deleted = self.client.delete(f"/api/delete/{created['id']}/", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(deleted.json(), {'success': True})
        self.assertFalse(APIKey.objects.exists())

    def test_validate_accepts_bearer_header(self):
        key = APIKey.objects.create(name='k', user=self.user, scopes=['read'])
        response = self.client.post('/api/validate/', HTTP_AUTHORIZATION=f'Bearer {key.key}')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['valid'])

    def test_generate_rejects_invalid_scope(self):
        self._login('alice')
        response = self._post('/api/generate/', {'name': 'x', 'scopes': ['root']})
        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json())
