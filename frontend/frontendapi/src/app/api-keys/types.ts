export interface APIKey {
  id: string;
  key?: string;
  name: string;
  description: string;
  user_id: string;
  username: string;
  scopes: string[];
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  usage_count: number;
}

export interface GenerateAPIKeyRequest {
  name: string;
  description: string;
  scopes: string[];
  expires_days?: number;
}

export interface APIKeyResponse {
  api_key: APIKey & { key: string };
}

export interface ListResponse {
  api_keys: APIKey[];
  total: number;
  is_staff_view: boolean;
}

export interface ValidationResponse {
  valid: boolean;
  key_id?: string;
  name?: string;
  user_id?: string;
  scopes?: string[];
  usage_count?: number;
  error?: string;
}
