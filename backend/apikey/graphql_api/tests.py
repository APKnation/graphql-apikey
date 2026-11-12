"""Contract tests for the superuser GraphQL API at /api/graphql/."""
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from api_keys.models import APIKey

KEY_FIELDS = (
    'id name description scopes isActive status usageCount expiresAt '
    'user { id username }'
)


class GraphQLAdminTests(TestCase):
    password = 's3cret-pass'

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('root', password=self.password)
        self.staff = User.objects.create_user(
            'staffer', password=self.password, is_staff=True
        )
        self.alice = User.objects.create_user('alice', password=self.password)
        self.bob = User.objects.create_user('bob', password=self.password)
        self.client = Client(enforce_csrf_checks=True)
        self.key = APIKey.objects.create(
            name='Alice key', user=self.alice, scopes=['read']
        )

    def gql(self, query, variables=None, csrf=True):
        headers = {}
        if csrf:
            token_response = self.client.get('/api/auth/csrf/')
            self.assertEqual(token_response.status_code, 200)
            headers['HTTP_X_CSRFTOKEN'] = token_response.json()['csrf_token']

        response = self.client.post(
            '/api/graphql/',
            json.dumps({'query': query, 'variables': variables or {}}),
            content_type='application/json',
            **headers,
        )
        if response['Content-Type'].startswith('application/json'):
            body = response.json()
        else:
            body = None
        return response.status_code, body

    def login(self, username):
        self.assertTrue(self.client.login(username=username, password=self.password))

    def assert_graphql_error(self, body, message):
        self.assertIn('errors', body)
        self.assertIn(message, body['errors'][0]['message'])

    def test_api_requires_authentication_and_superuser(self):
        _, body = self.gql('{ allApiKeys { id } }')
        self.assert_graphql_error(body, 'Authentication required.')

        self.login('staffer')
        _, body = self.gql('{ allApiKeys { id } }')
        self.assert_graphql_error(body, 'Superuser access required.')

        _, body = self.gql(
            'query($id: UUID!) { revealApiKey(id: $id) }',
            {'id': str(self.key.id)},
        )
        self.assertIsNone(body['data'])

    def test_csrf_is_enforced_for_graphql_posts(self):
        self.login('root')

        status, _ = self.gql('{ allApiKeys { id } }', csrf=False)

        self.assertEqual(status, 403)

    def test_key_queries_stats_and_secret_is_not_in_regular_fields(self):
        expired = APIKey.objects.create(
            name='Expired key',
            user=self.bob,
            scopes=['write'],
            expires_at=timezone.now() - timedelta(days=1),
            usage_count=3,
        )
        inactive = APIKey.objects.create(
            name='Inactive key',
            user=self.alice,
            scopes=['admin'],
            is_active=False,
            usage_count=2,
        )
        self.key.usage_count = 5
        self.key.save(update_fields=['usage_count'])
        self.login('root')

        _, body = self.gql(
            f'{{ allApiKeys {{ {KEY_FIELDS} }} adminStats {{ '
            'totalKeys activeKeys expiredKeys inactiveKeys totalUsage } }'
        )

        self.assertNotIn('errors', body)
        keys = {item['name']: item for item in body['data']['allApiKeys']}
        self.assertEqual(set(keys), {'Alice key', 'Expired key', 'Inactive key'})
        self.assertEqual(keys['Alice key']['user']['username'], 'alice')
        self.assertEqual(keys['Alice key']['status'], 'active')
        self.assertEqual(keys['Expired key']['status'], 'expired')
        self.assertEqual(keys['Inactive key']['status'], 'inactive')
        self.assertEqual(
            body['data']['adminStats'],
            {
                'totalKeys': 3,
                'activeKeys': 1,
                'expiredKeys': 1,
                'inactiveKeys': 1,
                'totalUsage': 10,
            },
        )
        self.assertNotIn('key', keys['Alice key'])

        _, body = self.gql(
            'query($id: UUID!) { apiKey(id: $id) { id name } '
            'revealApiKey(id: $id) }',
            {'id': str(self.key.id)},
        )
        self.assertNotIn('errors', body)
        self.assertEqual(body['data']['apiKey']['name'], 'Alice key')
        self.assertEqual(body['data']['revealApiKey'], self.key.key)

        _, body = self.gql(
            'query($id: UUID!) { revealApiKey(id: $id) }',
            {'id': str(expired.id)},
        )
        self.assertEqual(body['data']['revealApiKey'], expired.key)

    def test_search_status_filters_and_users_query(self):
        APIKey.objects.create(
            name='Read integration',
            description='Partner account',
            user=self.bob,
            scopes=['read'],
        )
        self.login('root')

        _, body = self.gql(
            'query($search: String, $status: String) { '
            'allApiKeys(search: $search, status: $status) { name } }',
            {'search': 'ALICE', 'status': 'active'},
        )
        self.assertEqual(
            [key['name'] for key in body['data']['allApiKeys']], ['Alice key']
        )

        _, body = self.gql(
            '{ allApiKeys(search: "Partner") { name } '
            'users { username } }'
        )
        self.assertEqual(
            [key['name'] for key in body['data']['allApiKeys']],
            ['Read integration'],
        )
        self.assertEqual(
            [user['username'] for user in body['data']['users']],
            ['alice', 'bob', 'root', 'staffer'],
        )

        _, body = self.gql('{ allApiKeys(status: "unknown") { id } }')
        self.assert_graphql_error(
            body, 'Status must be active, expired or inactive.'
        )

    def test_create_key_trims_fields_deduplicates_scopes_and_sets_owner(self):
        self.login('root')
        mutation = (
            'mutation($name: String!, $description: String!, '
            '$scopes: [String!]!, $userId: ID, $days: Int) { '
            'createApiKey(name: $name, description: $description, '
            'scopes: $scopes, userId: $userId, expiresDays: $days) { '
            f'key apiKey {{ {KEY_FIELDS} }} }}'
        )
        _, body = self.gql(
            mutation,
            {
                'name': ' Partner ',
                'description': '  integration key  ',
                'scopes': ['read', 'write', 'read'],
                'userId': str(self.alice.id),
                'days': 30,
            },
        )

        self.assertNotIn('errors', body)
        result = body['data']['createApiKey']
        created = result['apiKey']
        self.assertEqual(created['name'], 'Partner')
        self.assertEqual(created['description'], 'integration key')
        self.assertEqual(created['scopes'], ['read', 'write'])
        self.assertEqual(created['user']['username'], 'alice')
        self.assertIsNotNone(created['expiresAt'])
        self.assertEqual(
            APIKey.objects.get(id=created['id']).key, result['key']
        )

    def test_create_key_defaults_owner_and_never_expires(self):
        self.login('root')

        _, body = self.gql(
            'mutation { createApiKey(name: "Default owner", '
            'scopes: ["admin"]) { apiKey { name user { username } expiresAt } } }'
        )

        self.assertNotIn('errors', body)
        created = body['data']['createApiKey']['apiKey']
        self.assertEqual(created['user']['username'], 'root')
        self.assertIsNone(created['expiresAt'])

    def test_create_rejects_invalid_name_scopes_owner_and_expiration(self):
        self.login('root')
        cases = [
            (
                'mutation { createApiKey(name: "  ", scopes: ["read"]) { key } }',
                'Key name is required',
            ),
            (
                'mutation { createApiKey(name: "x", scopes: ["root"]) { key } }',
                'Choose at least one valid scope',
            ),
            (
                'mutation { createApiKey(name: "x", scopes: ["read"], '
                'userId: "99999999") { key } }',
                'Owner not found.',
            ),
            (
                'mutation { createApiKey(name: "x", scopes: ["read"], '
                'expiresDays: 0) { key } }',
                'Expiration must be between 1 and 3650 days.',
            ),
            (
                'mutation { createApiKey(name: "x", scopes: ["read"], '
                'expiresDays: 3651) { key } }',
                'Expiration must be between 1 and 3650 days.',
            ),
        ]

        for query, message in cases:
            with self.subTest(message=message):
                _, body = self.gql(query)
                self.assert_graphql_error(body, message)

        self.assertEqual(APIKey.objects.count(), 1)

    def test_update_changes_only_requested_fields_and_can_clear_expiration(self):
        self.key.expires_at = timezone.now() + timedelta(days=1)
        self.key.description = 'Original'
        self.key.save(update_fields=['expires_at', 'description'])
        self.login('root')
        mutation = (
            'mutation($id: UUID!) { updateApiKey(id: $id, name: "Renamed", '
            'scopes: ["admin"], isActive: false, expiresAt: null, '
            'userId: "%s") { apiKey { %s } } }'
            % (self.bob.id, KEY_FIELDS)
        )

        _, body = self.gql(mutation, {'id': str(self.key.id)})

        self.assertNotIn('errors', body)
        updated = body['data']['updateApiKey']['apiKey']
        self.assertEqual(
            (
                updated['name'],
                updated['description'],
                updated['scopes'],
                updated['isActive'],
                updated['status'],
                updated['expiresAt'],
                updated['user']['username'],
            ),
            ('Renamed', 'Original', ['admin'], False, 'inactive', None, 'bob'),
        )

    def test_update_validates_changes_without_persisting_invalid_values(self):
        self.login('root')
        cases = [
            (
                'mutation($id: UUID!) { updateApiKey(id: $id, name: " ") '
                '{ apiKey { id } } }',
                'Key name is required',
            ),
            (
                'mutation($id: UUID!) { updateApiKey(id: $id, scopes: []) '
                '{ apiKey { id } } }',
                'Choose at least one valid scope',
            ),
            (
                'mutation($id: UUID!) { updateApiKey(id: $id, isActive: null) '
                '{ apiKey { id } } }',
                'isActive cannot be null.',
            ),
        ]

        for query, message in cases:
            with self.subTest(message=message):
                _, body = self.gql(query, {'id': str(self.key.id)})
                self.assert_graphql_error(body, message)

        self.key.refresh_from_db()
        self.assertEqual(self.key.name, 'Alice key')
        self.assertEqual(self.key.scopes, ['read'])
        self.assertTrue(self.key.is_active)

    def test_delete_key_and_report_missing_keys(self):
        self.login('root')

        _, body = self.gql(
            'mutation($id: UUID!) { deleteApiKey(id: $id) { success id } }',
            {'id': str(self.key.id)},
        )
        self.assertNotIn('errors', body)
        self.assertTrue(body['data']['deleteApiKey']['success'])
        self.assertEqual(body['data']['deleteApiKey']['id'], str(self.key.id))
        self.assertFalse(APIKey.objects.filter(id=self.key.id).exists())

        _, body = self.gql(
            'mutation($id: UUID!) { deleteApiKey(id: $id) { success id } }',
            {'id': '00000000-0000-0000-0000-000000000000'},
        )
        self.assert_graphql_error(body, 'API key not found.')
