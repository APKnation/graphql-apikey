"""GraphQL API for superuser management of every API key (view, reveal, create, edit, delete)."""
from datetime import timedelta

import graphene
from django.contrib.auth import get_user_model
from django.db.models import Q, Sum
from django.utils import timezone
from graphene_django import DjangoObjectType
from graphql import GraphQLError

from api_keys.models import APIKey

User = get_user_model()
VALID_SCOPES = ('read', 'write', 'admin')


def require_superuser(info):
    user = info.context.user
    if not user.is_authenticated:
        raise GraphQLError('Authentication required.')
    if not user.is_superuser:
        raise GraphQLError('Superuser access required.')
    return user


def key_status(api_key):
    if not api_key.is_active:
        return 'inactive'
    if api_key.expires_at and api_key.expires_at <= timezone.now():
        return 'expired'
    return 'active'


def clean_name(name):
    name = (name or '').strip()
    if not name or len(name) > 100:
        raise GraphQLError('Key name is required and must be 100 characters or fewer.')
    return name


def clean_scopes(scopes):
    scopes = list(dict.fromkeys(scopes or []))
    if not scopes or any(scope not in VALID_SCOPES for scope in scopes):
        raise GraphQLError('Choose at least one valid scope: read, write, or admin.')
    return scopes


def get_key(key_id):
    try:
        return APIKey.objects.select_related('user').get(pk=key_id)
    except (APIKey.DoesNotExist, ValueError):
        raise GraphQLError('API key not found.')


class UserType(DjangoObjectType):
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'is_staff', 'is_superuser')


class APIKeyType(DjangoObjectType):
    """An API key. The secret is never exposed here; use the `revealApiKey` query."""

    scopes = graphene.List(graphene.NonNull(graphene.String), required=True)
    status = graphene.String(required=True, description='active, expired or inactive')

    class Meta:
        model = APIKey
        fields = (
            'id', 'name', 'description', 'user', 'scopes', 'is_active',
            'created_at', 'expires_at', 'last_used_at', 'usage_count',
        )

    def resolve_scopes(self, info):
        return self.scopes or []

    def resolve_status(self, info):
        return key_status(self)


class AdminStatsType(graphene.ObjectType):
    total_keys = graphene.Int(required=True)
    active_keys = graphene.Int(required=True)
    expired_keys = graphene.Int(required=True)
    inactive_keys = graphene.Int(required=True)
    total_usage = graphene.Int(required=True)


class Query(graphene.ObjectType):
    admin_stats = graphene.Field(AdminStatsType, required=True)
    all_api_keys = graphene.List(
        graphene.NonNull(APIKeyType),
        required=True,
        search=graphene.String(),
        status=graphene.String(description='active, expired or inactive'),
    )
    api_key = graphene.Field(APIKeyType, id=graphene.UUID(required=True))
    reveal_api_key = graphene.String(
        required=True, id=graphene.UUID(required=True), description='Full secret value of a key.'
    )
    users = graphene.List(graphene.NonNull(UserType), required=True)

    def resolve_admin_stats(self, info):
        require_superuser(info)
        now = timezone.now()
        keys = APIKey.objects.all()
        return AdminStatsType(
            total_keys=keys.count(),
            active_keys=keys.filter(is_active=True).filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=now)
            ).count(),
            expired_keys=keys.filter(is_active=True, expires_at__lte=now).count(),
            inactive_keys=keys.filter(is_active=False).count(),
            total_usage=keys.aggregate(total=Sum('usage_count'))['total'] or 0,
        )

    def resolve_all_api_keys(self, info, search=None, status=None):
        require_superuser(info)
        now = timezone.now()
        keys = APIKey.objects.select_related('user')
        if search:
            keys = keys.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(user__username__icontains=search)
            )
        if status == 'active':
            keys = keys.filter(is_active=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        elif status == 'expired':
            keys = keys.filter(is_active=True, expires_at__lte=now)
        elif status == 'inactive':
            keys = keys.filter(is_active=False)
        elif status:
            raise GraphQLError('Status must be active, expired or inactive.')
        return keys

    def resolve_api_key(self, info, id):
        require_superuser(info)
        return get_key(id)

    def resolve_reveal_api_key(self, info, id):
        require_superuser(info)
        return get_key(id).key

    def resolve_users(self, info):
        require_superuser(info)
        return User.objects.order_by('username')


class CreateApiKey(graphene.Mutation):
    class Arguments:
        name = graphene.String(required=True)
        description = graphene.String()
        scopes = graphene.List(graphene.NonNull(graphene.String), required=True)
        user_id = graphene.ID(description='Owner; defaults to the current user.')
        expires_days = graphene.Int(description='1-3650 days; omit for a key that never expires.')

    api_key = graphene.Field(APIKeyType, required=True)
    key = graphene.String(required=True, description='The new secret, returned once.')

    def mutate(self, info, name, scopes, description='', user_id=None, expires_days=None):
        current_user = require_superuser(info)
        owner = current_user
        if user_id is not None:
            owner = User.objects.filter(pk=user_id).first()
            if owner is None:
                raise GraphQLError('Owner not found.')
        expires_at = None
        if expires_days is not None:
            if not 1 <= expires_days <= 3650:
                raise GraphQLError('Expiration must be between 1 and 3650 days.')
            expires_at = timezone.now() + timedelta(days=expires_days)
        api_key = APIKey.objects.create(
            name=clean_name(name),
            description=(description or '').strip(),
            scopes=clean_scopes(scopes),
            user=owner,
            expires_at=expires_at,
        )
        return CreateApiKey(api_key=api_key, key=api_key.key)


class UpdateApiKey(graphene.Mutation):
    """Only the arguments you send are changed. Send `expiresAt: null` to remove the expiry."""

    class Arguments:
        id = graphene.UUID(required=True)
        name = graphene.String()
        description = graphene.String()
        scopes = graphene.List(graphene.NonNull(graphene.String))
        is_active = graphene.Boolean()
        expires_at = graphene.DateTime()
        user_id = graphene.ID()

    api_key = graphene.Field(APIKeyType, required=True)

    def mutate(self, info, id, **changes):
        require_superuser(info)
        api_key = get_key(id)
        if 'name' in changes:
            api_key.name = clean_name(changes['name'])
        if 'description' in changes:
            api_key.description = (changes['description'] or '').strip()
        if 'scopes' in changes:
            api_key.scopes = clean_scopes(changes['scopes'])
        if 'is_active' in changes:
            if changes['is_active'] is None:
                raise GraphQLError('isActive cannot be null.')
            api_key.is_active = changes['is_active']
        if 'expires_at' in changes:
            api_key.expires_at = changes['expires_at']
        if changes.get('user_id') is not None:
            owner = User.objects.filter(pk=changes['user_id']).first()
            if owner is None:
                raise GraphQLError('Owner not found.')
            api_key.user = owner
        api_key.save()
        return UpdateApiKey(api_key=api_key)


class DeleteApiKey(graphene.Mutation):
    class Arguments:
        id = graphene.UUID(required=True)

    success = graphene.Boolean(required=True)
    id = graphene.UUID(required=True)

    def mutate(self, info, id):
        require_superuser(info)
        get_key(id).delete()
        return DeleteApiKey(success=True, id=id)


class Mutation(graphene.ObjectType):
    create_api_key = CreateApiKey.Field()
    update_api_key = UpdateApiKey.Field()
    delete_api_key = DeleteApiKey.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)
