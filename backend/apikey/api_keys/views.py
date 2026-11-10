from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import APIKey
import secrets
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import models

User = get_user_model()

@login_required
def generate_api_key(request):
    """Generate a new API key"""
    if request.method == 'POST':
        name = request.POST.get('name', 'Default Key')
        description = request.POST.get('description', '')
        scopes = request.POST.getlist('scopes[]') or ['read']
        expires_days = request.POST.get('expires_days')
        
        # Create API key
        api_key = APIKey.objects.create(
            name=name,
            description=description,
            user=request.user,
            scopes=scopes
        )
        
        if expires_days:
            from datetime import timedelta
            api_key.expires_at = timezone.now() + timedelta(days=int(expires_days))
            api_key.save()
        
        return JsonResponse({
            'success': True,
            'api_key': {
                'id': str(api_key.id),
                'name': api_key.name,
                'key': api_key.key,
                'description': api_key.description,
                'scopes': api_key.scopes,
                'created_at': api_key.created_at.isoformat(),
                'expires_at': api_key.expires_at.isoformat() if api_key.expires_at else None,
                'is_valid': api_key.is_valid()
            }
        })
    
    # GET request - show form
    return render(request, 'api_keys/generate_key.html')

@login_required
def list_api_keys(request):
    """List all API keys for the current user"""
    api_keys = APIKey.objects.filter(user=request.user)
    return render(request, 'api_keys/list_keys.html', {'api_keys': api_keys})

@login_required
@require_http_methods(['DELETE'])
def delete_api_key(request, key_id):
    """Delete an API key"""
    api_key = get_object_or_404(APIKey, id=key_id, user=request.user)
    api_key.delete()
    return JsonResponse({'success': True})

@csrf_exempt
@api_view(['POST'])
@permission_classes([])
def validate_api_key(request):
    """Validate an API key for external service access"""
    api_key_str = request.META.get('HTTP_AUTHORIZATION', '').replace('Bearer ', '')
    
    if not api_key_str:
        return Response({'error': 'API key not provided'}, status=401)
    
    try:
        api_key = APIKey.objects.get(key=api_key_str)
        
        if not api_key.is_valid():
            return Response({
                'error': 'API key is invalid or expired',
                'valid': False
            }, status=401)
        
        # Increment usage counter
        api_key.increment_usage()
        
        return Response({
            'valid': True,
            'key_id': str(api_key.id),
            'name': api_key.name,
            'user_id': str(api_key.user.id),
            'scopes': api_key.scopes,
            'usage_count': api_key.usage_count
        })
    except APIKey.DoesNotExist:
        return Response({'error': 'Invalid API key'}, status=401)

@staff_member_required
def admin_dashboard(request):
    """Admin dashboard for API key management"""
    total_keys = APIKey.objects.count()
    active_keys = APIKey.objects.filter(is_active=True).count()
    expired_keys = APIKey.objects.filter(
        is_active=True,
        expires_at__lt=timezone.now()
    ).count()
    total_usage = APIKey.objects.aggregate(total=models.Sum('usage_count'))['total'] or 0
    
    recent_keys = APIKey.objects.select_related('user').order_by('-created_at')[:10]
    
    context = {
        'total_keys': total_keys,
        'active_keys': active_keys,
        'expired_keys': expired_keys,
        'total_usage': total_usage,
        'recent_keys': recent_keys,
    }
    
    return render(request, 'api_keys/admin_dashboard.html', context)