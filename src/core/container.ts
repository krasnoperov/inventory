import { Container } from 'inversify';
import { TYPES } from './di-types';
import type { Env } from './types';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { createDb } from '../db';

// Import DAOs
import { UserDAO } from '../dao/user-dao';
import { SpaceDAO } from '../dao/space-dao';
import { MemberDAO } from '../dao/member-dao';
import { JobDAO } from '../dao/job-dao';
import { UsageEventDAO } from '../dao/usage-event-dao';
import { MemoryDAO } from '../dao/memory-dao';

// Import Auth Services
import { AuthService } from '../backend/features/auth/auth-service';
import { AuthController } from '../backend/features/auth/auth-controller';
import { AuthHandler } from '../backend/features/auth/auth-handler';

// Import Domain Services
import { NanoBananaService } from '../backend/services/nanoBananaService';
import { PolarService } from '../backend/services/polarService';
import { UsageService } from '../backend/services/usageService';
import { MemoryService } from '../backend/services/memoryService';

/**
 * Create and configure the dependency injection container
 * This is the heart of the bare framework - add your services here
 */
export function createContainer(env: Env): Container {
  const container = new Container();

  // Bind environment
  container.bind<Env>(TYPES.Env).toConstantValue(env);

  // Bind database
  container.bind<Kysely<Database>>(TYPES.Database).toDynamicValue(() => {
    return createDb(env.DB);
  }).inSingletonScope();

  // Bind DAOs
  container.bind(UserDAO).toSelf().inSingletonScope();
  container.bind(TYPES.UserDAO).toService(UserDAO);

  container.bind(SpaceDAO).toSelf().inSingletonScope();
  container.bind(TYPES.SpaceDAO).toService(SpaceDAO);

  container.bind(MemberDAO).toSelf().inSingletonScope();
  container.bind(TYPES.MemberDAO).toService(MemberDAO);

  container.bind(JobDAO).toSelf().inSingletonScope();
  container.bind(TYPES.JobDAO).toService(JobDAO);

  container.bind(UsageEventDAO).toSelf().inSingletonScope();
  container.bind(TYPES.UsageEventDAO).toService(UsageEventDAO);

  container.bind(MemoryDAO).toSelf().inSingletonScope();
  container.bind(TYPES.MemoryDAO).toService(MemoryDAO);

  // Bind Auth Services
  container.bind(AuthService).toSelf().inSingletonScope();
  container.bind(AuthController).toSelf().inSingletonScope();
  container.bind(AuthHandler).toSelf().inSingletonScope();

  // Bind Domain Services
  if (env.GOOGLE_AI_API_KEY) {
    container.bind(NanoBananaService).toDynamicValue(() => (
      new NanoBananaService(env.GOOGLE_AI_API_KEY!)
    )).inSingletonScope();
  }

  // Bind Billing Services (Polar.sh)
  // PolarService always bound - it handles missing token gracefully internally
  container.bind(PolarService).toSelf().inSingletonScope();

  // UsageService always bound (works with or without Polar)
  container.bind(UsageService).toSelf().inSingletonScope();

  // Memory & Personalization
  container.bind(MemoryService).toSelf().inSingletonScope();

  return container;
}
