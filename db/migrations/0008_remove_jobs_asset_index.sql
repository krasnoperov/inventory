-- Remove unused jobs and asset_index tables
-- Jobs are tracked ephemerally in frontend state, not D1
-- Asset index was for cross-space search which is not needed

DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS asset_index;
