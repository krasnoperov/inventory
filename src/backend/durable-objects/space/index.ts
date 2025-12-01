/**
 * Space module - extracted utilities and types from SpaceDO
 *
 * This module provides:
 * - Type definitions for DO SQLite schema and WebSocket messages
 * - SQL query constants and builders
 * - Domain-specific utilities (hierarchy, image refs, vision)
 */

// Types
export * from './types';

// SQL Queries and builders
export * from './queries';

// Asset hierarchy utilities (cycle detection, ancestor chain, descendants)
export * from './asset/hierarchy';

// Variant image reference counting
export * from './variant/imageRefs';

// Lineage graph building
export * from './lineage/graph';

// Vision service (describe/compare orchestration)
export * from './vision/VisionService';

// Repository (data access layer)
export * from './repository/SpaceRepository';

// Domain controllers
export * from './controllers';

// Schema management
export * from './schema/SchemaManager';
