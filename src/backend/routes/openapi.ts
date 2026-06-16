import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppContext } from './types';
import type { ApiUser, UserProfile, Space } from '../../shared/api/schemas';
import type { User as DbUser, Space as DbSpace } from '../../db/types';

export function createOpenApiRouter() {
  return new OpenAPIHono<AppContext>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Invalid request' }, 400);
      }
    },
  });
}

export function toApiUser(user: {
  id: number;
  email: string;
  name: string;
  google_id: string | null;
  created_at?: string;
  updated_at?: string;
}): ApiUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    google_id: user.google_id,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export function toUserProfile(user: {
  id: number;
  email: string;
  name: string;
}): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

export function toApiSpace(
  space: DbSpace,
  role: Space['role'],
): Space {
  return {
    id: space.id,
    name: space.name,
    owner_id: space.owner_id,
    role,
    created_at: space.created_at,
  };
}

export function dbUserToApiUser(user: DbUser): ApiUser {
  return toApiUser(user);
}
