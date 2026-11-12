"""Tests for the superuser GraphQL API at /api/graphql/ (used by the Angular admin page)."""
import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from api_keys.models import APIKey

KEY_FIELDS = 'id name description scopes isActive status usageCount expiresAt user { id username }'


class GraphQLAdminTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('root', password='s3cret-pass')
        self.staff = User.objects.create_user('staffer', password='s3cret-pass', is_staff=True)
        self.alice = User.objects.create_user('alice', password='s3cret-pass')
        self.key = APIKey.objects.create(name='Alice key', user=self.alice, scopes=['read'])
        self.client = Client(enforce_csrf_checks=True)

    def gql(self, query, variables=None, csrf=True):
        headers = {}
        if csrf:
            token = self.client.get('/api/auth/csrf/').json()['csrf_token']
            headers['HTTP_X_CSRFTOKEN'] = token
        response = self.client.post(
            '/api/graphql/',
            json.dumps({'query': query, 'variables': variables or {}}),
            content_type='application/json',
            **headers,
        )
        is_json = response['Content-Type'].startswith('application/json')
        return response.status_code, response.json() if is_json else None

    def login(self, username):
        self.client.login(username=username, password='s3cret-pass')

    def test_requires_superuser(self):
        _, body = self.gql('{ allApiKeys { id } }')
        self.assertEqual(body['errors'][0]['message'], 'Authentication required.')
        self.login('staffer')
        _, body = self.gql('{ allApiKeys { id } }')
        self.assertEqual(body['errors'][0]['message'], 'Superuser access required.')
        _, body = self.gql('query($id: UUID!) { revealApiKey(id: $id) }', {'id': str(self.key.id)})
        self.assertIsNone(body['data'])

    def test_csrf_is_enforced(self):
        self.login('root')
        status, _ = self.gql('{ allApiKeys { id } }', csrf=False)
        self.assertEqual(status, 403)

    def test_list_stats_and_reveal(self):
        self.login('root')
        _, body = self.gql(f'{{ allApiKeys {{ {KEY_FIELDS} }} adminStats {{ totalKeys activeKeys totalUsage }} }}')
        self.assertNotIn('errors', body)
        keys = body['data']['allApiKeys']
        self.assertEqual([k['name'] for k in keys], ['Alice key'])
        self.assertEqual(keys[0]['user']['username'], 'alice')
        self.assertEqual(keys[0]['status'], 'active')
        self.assertEqual(body['data']['adminStats'], {'totalKeys': 1, 'activeKeys': 1, 'totalUsage': 0})

        _, body = self.gql('query($id: UUID!) { revealApiKey(id: $id) }', {'id': str(self.key.id)})
        self.assertEqual(body['data']['revealApiKey'], self.key.key)

    def test_create_update_delete(self):
        self.login('root')
        _, body = self.gql(
            f'''mutation($name: String!, $scopes: [String!]!, $userId: ID, $days: Int) {{
                createApiKey(name: $name, scopes: $scopes, userId: $userId, expiresDays: $days) {{
                    key apiKey {{ {KEY_FIELDS} }}
                }}
            }}''',
            {'name': ' Partner ', 'scopes': ['read', 'write'], 'userId': str(self.alice.id), 'days': 30},
        )
        self.assertNotIn('errors', body)
        created = body['data']['createApiKey']
        self.assertEqual(created['apiKey']['name'], 'Partner')
        self.assertEqual(created['apiKey']['user']['username'], 'alice')
        self.assertIsNotNone(created['apiKey']['expiresAt'])
        self.assertEqual(APIKey.objects.get(id=created['apiKey']['id']).key, created['key'])

        _, body = self.gql(
            f'''mutation($id: UUID!) {{
                updateApiKey(id: $id, name: "Renamed", scopes: ["admin"], isActive: false, expiresAt: null) {{
                    apiKey {{ {KEY_FIELDS} }}
                }}
            }}''',
            {'id': created['apiKey']['id']},
        )
        updated = body['data']['updateApiKey']['apiKey']
        self.assertEqual(
            (updated['name'], updated['scopes'], updated['isActive'], updated['status'], updated['expiresAt']),
            ('Renamed', ['admin'], False, 'inactive', None),
        )
        self.assertEqual(updated['description'], '')  # untouched fields stay as they were

        _, body = self.gql(
            'mutation($id: UUID!) { deleteApiKey(id: $id) { success id } }', {'id': created['apiKey']['id']}
        )
        self.assertTrue(body['data']['deleteApiKey']['success'])
        self.assertFalse(APIKey.objects.filter(id=created['apiKey']['id']).exists())

    def test_validation_errors(self):
        self.login('root')
        _, body = self.gql('mutation { createApiKey(name: "x", scopes: ["root"]) { key } }')
        self.assertIn('valid scope', body['errors'][0]['message'])
        _, body = self.gql('mutation { createApiKey(name: "  ", scopes: ["read"]) { key } }')
        self.assertIn('Key name is required', body['errors'][0]['message'])
        _, body = self.gql(
            'mutation { deleteApiKey(id: "00000000-0000-0000-0000-000000000000") { success } }'
        )
        self.assertEqual(body['errors'][0]['message'], 'API key not found.')
