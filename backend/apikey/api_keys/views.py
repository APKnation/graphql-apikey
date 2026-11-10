import json
from datetime import timedelta
from functools import wraps

from django.contrib.auth import authenticate, login, logout
from django.db import models
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST
from django.middleware.csrf import get_token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import APIKey

VALID_SCOPES = {'read', 'write', 'admin'}


def _json_body(request):
    try:
        body = json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError('Request body must contain valid JSON.')
    if not isinstance(body, dict):
        raise ValueError('Request body must be a JSON object.')
    return body


def _serialize_key(api_key, include_key=False):
    data = {
        'id': str(api_key.id),
        'name': api_key.name,
        'description': api_key.description,
        'user_id': str(api_key.user_id),
        'username': api_key.user.get_username(),
        'scopes': api_key.scopes,
        'is_active': api_key.is_active,
        'created_at': api_key.created_at.isoformat(),
        'expires_at': api_key.expires_at.isoformat() if api_key.expires_at else None,
        'last_used_at': api_key.last_used_at.isoformat() if api_key.last_used_at else None,
        'usage_count': api_key.usage_count,
    }
    if include_key:
        data['key'] = api_key.key
    return data


def api_login_required(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required.'}, status=401)
        return view(request, *args, **kwargs)
    return wrapped


@ensure_csrf_cookie
@require_GET
def csrf_token(request):
    return JsonResponse({'csrf_token': get_token(request)})


@require_POST
def login_view(request):
    try:
        data = _json_body(request)
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)

    username = data.get('username')
    password = data.get('password')
    if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
        return JsonResponse({'error': 'Enter both username and password.'}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({'error': 'Username or password is incorrect.'}, status=401)

    login(request, user)
    return JsonResponse({
        'id': str(user.pk),
        'username': user.get_username(),
        'is_staff': user.is_staff,
    })


@api_login_required
@require_GET
def current_user(request):
    return JsonResponse({
        'id': str(request.user.pk),
        'username': request.user.get_username(),
        'is_staff': request.user.is_staff,
    })


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'success': True})


@api_login_required
@require_POST
def generate_api_key(request):
    try:
        data = _json_body(request)
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)

    name = data.get('name')
    description = data.get('description', '')
    scopes = data.get('scopes', ['read'])
    expires_days = data.get('expires_days')

    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        return JsonResponse({'error': 'Key name is required and must be 100 characters or fewer.'}, status=400)
    if not isinstance(description, str):
        return JsonResponse({'error': 'Description must be text.'}, status=400)
    if not isinstance(scopes, list) or not scopes or any(
        not isinstance(scope, str) or scope not in VALID_SCOPES for scope in scopes
    ):
        return JsonResponse({'error': 'Choose at least one valid scope: read, write, or admin.'}, status=400)

    expires_at = None
    if expires_days is not None:
        if isinstance(expires_days, bool) or not isinstance(expires_days, int) or not 1 <= expires_days <= 3650:
            return JsonResponse({'error': 'Expiration must be between 1 and 3650 days.'}, status=400)
        expires_at = timezone.now() + timedelta(days=expires_days)

    api_key = APIKey.objects.create(
        name=name.strip(),
        description=description.strip(),
        user=request.user,
        scopes=scopes,
        expires_at=expires_at,
    )
    return JsonResponse({'api_key': _serialize_key(api_key, include_key=True)}, status=201)


@api_login_required
@require_GET
def list_api_keys(request):
    is_staff_view = request.user.is_staff
    api_keys = APIKey.objects.select_related('user')
    if not is_staff_view:
        api_keys = api_keys.filter(user=request.user)
    data = [_serialize_key(api_key) for api_key in api_keys]
    return JsonResponse({
        'api_keys': data,
        'total': len(data),
        'is_staff_view': is_staff_view,
    })


@api_login_required
@require_http_methods(['DELETE'])
def delete_api_key(request, key_id):
    api_keys = APIKey.objects.filter(id=key_id)
    if not request.user.is_staff:
        api_keys = api_keys.filter(user=request.user)
    deleted, _ = api_keys.delete()
    if not deleted:
        return JsonResponse({'error': 'API key not found.'}, status=404)
    return JsonResponse({'success': True})


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def validate_api_key(request):
    """Validate a bearer key for external API clients."""
    api_key_str = request.headers.get('Authorization', '')
    if api_key_str.lower().startswith('bearer '):
        api_key_str = api_key_str[7:].strip()
    else:
        api_key_str = request.data.get('key', '')

    if not isinstance(api_key_str, str) or not api_key_str.strip():
        return Response({'error': 'Provide an API key.', 'valid': False}, status=400)

    try:
        api_key = APIKey.objects.select_related('user').get(key=api_key_str.strip())
    except APIKey.DoesNotExist:
        return Response({'error': 'API key is invalid or expired.', 'valid': False}, status=401)

    if not api_key.is_valid():
        return Response({'error': 'API key is invalid or expired.', 'valid': False}, status=401)

    api_key.increment_usage()
    return Response({
        'valid': True,
        'key_id': str(api_key.id),
        'name': api_key.name,
        'user_id': str(api_key.user_id),
        'scopes': api_key.scopes,
        'usage_count': api_key.usage_count,
    })


@api_login_required
@require_GET
def admin_dashboard(request):
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff access required.'}, status=403)

    now = timezone.now()
    active_keys = APIKey.objects.filter(is_active=True).filter(
        models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=now)
    )
    total_usage = APIKey.objects.aggregate(total=models.Sum('usage_count'))['total'] or 0
    recent_keys = APIKey.objects.select_related('user').order_by('-created_at')[:10]

    return JsonResponse({
        'total_keys': APIKey.objects.count(),
        'active_keys': active_keys.count(),
        'expired_keys': APIKey.objects.filter(is_active=True, expires_at__lt=now).count(),
        'total_usage': total_usage,
        'recent_keys': [_serialize_key(api_key) for api_key in recent_keys],
    })
