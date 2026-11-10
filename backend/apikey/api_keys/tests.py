import json

from django.test import TestCase
from django.contrib.auth import get_user_model
from api_keys.models import APIKey
from datetime import timedelta
from django.utils import timezone
from django.test import Client

User = get_user_model()

class APIKeyModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='testpass123')
    
    def test_api_key_creation(self):
        """Test that API key is created with a secure key"""
        api_key = APIKey.objects.create(
            name='Test Key',
            user=self.user,
            scopes=['read', 'write']
        )
        
        self.assertIsNotNone(api_key.key)
        self.assertEqual(api_key.name, 'Test Key')
        self.assertEqual(api_key.user, self.user)
        self.assertEqual(api_key.scopes, ['read', 'write'])
        self.assertTrue(api_key.is_valid())
    
    def test_api_key_unique_key(self):
        """Test that each API key has a unique key"""
        api_key1 = APIKey.objects.create(
            name='Test Key 1',
            user=self.user
        )
        api_key2 = APIKey.objects.create(
            name='Test Key 2',
            user=self.user
        )
        
        self.assertNotEqual(api_key1.key, api_key2.key)
    
    def test_api_key_expiry(self):
        """Test API key expiration"""
        expires_at = timezone.now() + timedelta(days=30)
        api_key = APIKey.objects.create(
            name='Expiring Key',
            user=self.user,
            expires_at=expires_at
        )
        
        self.assertEqual(api_key.expires_at, expires_at)
        self.assertTrue(api_key.is_valid())
        
        # Test expired key
        api_key.expires_at = timezone.now() - timedelta(days=1)
        api_key.save()
        self.assertFalse(api_key.is_valid())
    
    def test_api_key_inactive(self):
        """Test inactive API key"""
        api_key = APIKey.objects.create(
            name='Inactive Key',
            user=self.user,
            is_active=False
        )
        
        self.assertFalse(api_key.is_valid())
    
    def test_increment_usage(self):
        """Test incrementing usage counter"""
        api_key = APIKey.objects.create(
            name='Usage Test Key',
            user=self.user
        )
        
        initial_usage = api_key.usage_count
        api_key.increment_usage()
        
        self.assertEqual(api_key.usage_count, initial_usage + 1)
        self.assertIsNotNone(api_key.last_used_at)

class APIKeyViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='testpass123')
        self.other_user = User.objects.create_user(username='otheruser', password='testpass123')
        self.client = Client()
        self.client.force_login(self.user)
        self.api_key = APIKey.objects.create(
            name='Test Key',
            user=self.user
        )

    def json_request(self, method, path, data=None, **extra):
        body = json.dumps(data or {})
        return getattr(self.client, method)(path, body, content_type='application/json', **extra)

    def test_authentication_endpoints(self):
        self.client.logout()
        csrf = self.client.get('/api/auth/csrf/')
        self.assertEqual(csrf.status_code, 200)
        self.assertIn('csrf_token', csrf.json())

        response = self.json_request('post', '/api/auth/login/', {
            'username': 'testuser',
            'password': 'testpass123',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['username'], 'testuser')
        self.assertEqual(self.client.get('/api/auth/me/').json()['username'], 'testuser')

        response = self.json_request('post', '/api/auth/logout/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_list_api_keys(self):
        response = self.client.get('/api/list/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['total'], 1)
        self.assertEqual(response.json()['api_keys'][0]['name'], 'Test Key')
        self.assertNotIn('key', response.json()['api_keys'][0])

        APIKey.objects.create(name='Other user key', user=self.other_user)
        self.assertEqual(self.client.get('/api/list/').json()['total'], 1)

    def test_generate_api_key(self):
        response = self.json_request('post', '/api/generate/', {
            'name': 'New Key',
            'description': 'Integration test',
            'scopes': ['read', 'write'],
            'expires_days': 30,
        })
        self.assertEqual(response.status_code, 201)
        self.assertIn('key', response.json()['api_key'])
        self.assertEqual(response.json()['api_key']['scopes'], ['read', 'write'])
        self.assertEqual(APIKey.objects.filter(user=self.user).count(), 2)

    def test_generate_rejects_invalid_input(self):
        response = self.json_request('post', '/api/generate/', {'name': '', 'scopes': ['unknown']})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(APIKey.objects.filter(user=self.user).count(), 1)

    def test_delete_api_key(self):
        response = self.client.delete(f'/api/delete/{self.api_key.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(APIKey.objects.filter(id=self.api_key.id).exists())

    def test_delete_does_not_remove_another_users_key(self):
        other_key = APIKey.objects.create(name='Private key', user=self.other_user)
        response = self.client.delete(f'/api/delete/{other_key.id}/')
        self.assertEqual(response.status_code, 404)
        self.assertTrue(APIKey.objects.filter(id=other_key.id).exists())

    def test_validate_api_key_with_json_body(self):
        response = self.json_request('post', '/api/validate/', {'key': self.api_key.key})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['valid'])
        self.api_key.refresh_from_db()
        self.assertEqual(self.api_key.usage_count, 1)

    def test_validate_api_key_with_bearer_header(self):
        response = self.client.post('/api/validate/', {}, HTTP_AUTHORIZATION=f'Bearer {self.api_key.key}')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['valid'])

    def test_invalid_key_returns_json_error(self):
        response = self.json_request('post', '/api/validate/', {'key': 'not-a-key'})
        self.assertEqual(response.status_code, 401)

    def test_login_with_csrf_protection_enabled(self):
        client = Client(enforce_csrf_checks=True)
        csrf = client.get('/api/auth/csrf/')
        self.assertEqual(csrf.status_code, 200)

        response = client.post(
            '/api/auth/login/',
            json.dumps({'username': 'testuser', 'password': 'testpass123'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf.json()['csrf_token'],
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get('/api/auth/me/').json()['username'], 'testuser')
        self.assertFalse(response.json()['valid'])

    def test_user_api_endpoints_require_login(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/list/').status_code, 401)
        self.assertEqual(self.json_request('post', '/api/generate/', {'name': 'No session'}).status_code, 401)

    def test_admin_dashboard_requires_staff(self):
        response = self.client.get('/api/admin-dashboard/')
        self.assertEqual(response.status_code, 403)
        self.assertIn('error', response.json())

        staff_user = User.objects.create_user(username='staff', password='testpass123', is_staff=True)
        self.client.force_login(staff_user)
        response = self.client.get('/api/admin-dashboard/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['total_keys'], 1)
