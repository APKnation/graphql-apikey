from django.db import models
import secrets
import uuid
from django.utils import timezone
from django.contrib.auth import get_user_model

User = get_user_model()

class APIKey(models.Model):
    """Model for storing API keys"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=128, unique=True, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='api_keys')
    scopes = models.JSONField(default=list, help_text='List of permissions/scopes')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    usage_count = models.PositiveIntegerField(default=0)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.name} ({self.user.username})"
    
    def save(self, *args, **kwargs):
        if not self.key:
            # Generate a secure random API key
            self.key = secrets.token_urlsafe(32)
        super().save(*args, **kwargs)
    
    def is_valid(self):
        """Check if the API key is still valid"""
        if not self.is_active:
            return False
        if self.expires_at and self.expires_at < timezone.now():
            return False
        return True
    
    def increment_usage(self):
        """Increment usage counter and update last used time"""
        self.usage_count += 1
        self.last_used_at = timezone.now()
        self.save(update_fields=['usage_count', 'last_used_at'])
