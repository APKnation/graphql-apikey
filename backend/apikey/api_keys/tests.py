from django.test import TestCase
from django.contrib.auth import get_user_model
from .models import APIKey
import secrets
from datetime import timedelta
from django.utils import timezone

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
        self.client.login(username='testuser', password='testpass123')
        self.api_key = APIKey.objects.create(
            name='Test Key',
            user=self.user
        )
    
    def test_list_api_keys(self):
        """Test listing API keys"""
        response = self.client.get('/api/keys/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Test Key')
    
    def test_generate_api_key(self):
        """Test API key generation"""
        response = self.client.post('/api/keys/generate/', {
            'name': 'New Key'
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn('api_key', response.json())
    
    def test_delete_api_key(self):
        """Test deleting an API key"""
        response = self.client.delete(f'/api/keys/{self.api_key.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(APIKey.objects.filter(id=self.api_key.id).exists())
    
    def test_validate_api_key(self):
        """Test API key validation"""
        response = self.client.post('/api/validate/', {
            'key': self.api_key.key
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['valid'])
