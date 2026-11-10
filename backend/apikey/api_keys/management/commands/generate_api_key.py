"""Django management command for generating API keys"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from api_keys.models import APIKey
import secrets

User = get_user_model()

class Command(BaseCommand):
    help = 'Generate a new API key for a user'
    
    def add_arguments(self, parser):
        parser.add_argument('username', type=str, help='Username to generate API key for')
        parser.add_argument('--name', type=str, default='Command Generated Key', help='Name for the API key')
        parser.add_argument('--description', type=str, default='', help='Description for the API key')
        parser.add_argument('--scopes', type=str, nargs='+', default=['read'], help='List of scopes for the API key')
        parser.add_argument('--expires-days', type=int, help='Number of days until the API key expires')
    
    def handle(self, *args, **options):
        try:
            user = User.objects.get(username=options['username'])
        except User.DoesNotExist:
            self.stderr.write(f"User '{options['username']}' does not exist")
            return
        
        # Create API key
        api_key = APIKey.objects.create(
            name=options['name'],
            description=options['description'],
            user=user,
            scopes=options['scopes']
        )
        
        # Set expiration if specified
        if options['expires_days']:
            from datetime import timedelta
            from django.utils import timezone
            api_key.expires_at = timezone.now() + timedelta(days=options['expires_days'])
            api_key.save()
        
        # Output the API key
        self.stdout.write(self.style.SUCCESS('API key generated successfully!'))
        self.stdout.write(f"\nKey Details:")
        self.stdout.write(f"  Name: {api_key.name}")
        self.stdout.write(f"  Description: {api_key.description}")
        self.stdout.write(f"  User: {user.username}")
        self.stdout.write(f"  Scopes: {', '.join(api_key.scopes)}")
        self.stdout.write(f"  Expires: {api_key.expires_at.strftime('%Y-%m-%d %H:%M:%S') if api_key.expires_at else 'Never'}")
        
        self.stdout.write(f"\n{'='*60}")
        self.stdout.write(self.style.WARNING('IMPORTANT: Store this key securely! It will not be shown again.'))
        self.stdout.write(f"\nAPI Key: {api_key.key}")
        self.stdout.write(f"{'='*60}")