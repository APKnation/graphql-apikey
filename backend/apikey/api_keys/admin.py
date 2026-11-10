from django.contrib import admin
from .models import APIKey

@admin.register(APIKey)
class APIKeyAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'is_active', 'created_at', 'expires_at', 'usage_count')
    list_filter = ('is_active', 'created_at', 'expires_at')
    search_fields = ('name', 'user__username', 'user__email', 'key')
    readonly_fields = ('key', 'created_at', 'last_used_at', 'usage_count')
    fieldsets = (
        ('API Key Information', {
            'fields': ('name', 'description', 'user', 'scopes', 'is_active')
        }),
        ('Validity', {
            'fields': ('created_at', 'expires_at', 'last_used_at', 'usage_count')
        }),
        ('Security', {
            'fields': ('key',)
        })
    )
    
    def has_delete_permission(self, request, obj=None):
        return True
    
    def has_change_permission(self, request, obj=None):
        # Allow viewing but not editing the key
        return True
