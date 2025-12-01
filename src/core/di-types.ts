export const TYPES = {
  // Environment binding
  Env: Symbol.for('Env'),

  // Database binding
  Database: Symbol.for('Database'),

  // DAO symbols
  UserDAO: Symbol.for('UserDAO'),
  SpaceDAO: Symbol.for('SpaceDAO'),
  MemberDAO: Symbol.for('MemberDAO'),
  UsageEventDAO: Symbol.for('UsageEventDAO'),
  MemoryDAO: Symbol.for('MemoryDAO'),

  // For classes, we use the class constructor directly
  // This file only contains symbols for non-class bindings
} as const;
