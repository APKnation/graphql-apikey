"""
URL configuration for api_keys app.
"""
from django.urls import path
from .views import (
    admin_dashboard,
    csrf_token,
    current_user,
    delete_api_key,
    generate_api_key,
    list_api_keys,
    login_view,
    logout_view,
    validate_api_key,
)

app_name = 'api_keys'

urlpatterns = [
    path('auth/csrf/', csrf_token, name='csrf'),
    path('auth/login/', login_view, name='login'),
    path('auth/logout/', logout_view, name='logout'),
    path('auth/me/', current_user, name='current_user'),
    path('generate/', generate_api_key, name='generate'),
    path('list/', list_api_keys, name='list'),
    path('delete/<uuid:key_id>/', delete_api_key, name='delete'),
    path('validate/', validate_api_key, name='validate'),
    path('admin-dashboard/', admin_dashboard, name='admin_dashboard'),
]