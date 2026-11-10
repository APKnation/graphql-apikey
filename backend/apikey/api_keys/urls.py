"""
URL configuration for api_keys app.
"""
from django.urls import path
from .views import generate_api_key, list_api_keys, delete_api_key, validate_api_key, admin_dashboard

app_name = 'api_keys'

urlpatterns = [
    path('generate/', generate_api_key, name='generate'),
    path('list/', list_api_keys, name='list'),
    path('delete/<uuid:key_id>/', delete_api_key, name='delete'),
    path('validate/', validate_api_key, name='validate'),
    path('admin-dashboard/', admin_dashboard, name='admin_dashboard'),
]