-- Add parent_asset_id to asset_index for hierarchical asset structure

ALTER TABLE asset_index ADD COLUMN parent_asset_id TEXT;

-- Index for efficient child lookup
CREATE INDEX idx_asset_index_parent ON asset_index(parent_asset_id);
