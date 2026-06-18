import { Thumbnail } from 'makefx';

// Minimal Variant factory (design tool has no media server, so use states that
// render without loading a real image: empty, loading, failed, completed-audio).
const v = (o) => ({
  id: 'v', asset_id: 'a', media_kind: 'image', workflow_id: null, status: 'processing',
  error_message: null, image_key: null, thumb_key: null, media_key: null, media_mime_type: null,
  media_size_bytes: null, media_width: null, media_height: null, media_duration_ms: null,
  recipe: '{}', starred: false, created_by: 'u', created_at: 0, updated_at: null, description: null, ...o,
});
const Row = ({ children }) => <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>{children}</div>;

export const States = () => (
  <Row>
    <Thumbnail variant={null} size="md" />
    <Thumbnail variant={v({ status: 'processing' })} size="md" />
    <Thumbnail variant={v({ status: 'failed', error_message: 'Generation timed out' })} size="md" onRetry={() => {}} />
  </Row>
);
export const Sizes = () => (
  <Row>
    {['xs', 'sm', 'md', 'lg'].map((s) => <Thumbnail key={s} variant={v({ status: 'processing' })} size={s} />)}
  </Row>
);
export const Badges = () => (
  <Row>
    <Thumbnail variant={v({ media_kind: 'audio', status: 'completed', media_key: 'a.mp3' })} size="md" showBadges isActive />
    <Thumbnail variant={v({ media_kind: 'audio', status: 'completed', media_key: 'a.mp3', starred: true })} size="md" showBadges />
  </Row>
);
