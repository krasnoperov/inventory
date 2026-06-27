# Space Sharing Rollout Checklist

Use this checklist before enabling Space sharing broadly in stage or production.
Run it with two real users: an owner and a requester who is not already a member.

## Preconditions

- The app worker has `EMAIL` bound and `MAKEFX_EMAIL_FROM` set to a verified sender.
- `PUBLIC_SITE_ORIGIN` points at the environment under test.
- Both test users can sign in without dev-auth shortcuts.
- No manual SQL membership changes are used during the smoke test.

## Happy Path

1. Owner creates a new Space and adds one visible test asset with completed media.
2. Requester opens `/spaces/:spaceId` and sees the private Space access request page, not Space or asset metadata.
3. Requester submits access once, then retries the request action. Confirm the page remains pending and only one owner request notification is delivered.
4. Owner opens the sharing panel and sees the requester in incoming requests.
5. Owner approves the requester as `viewer`.
6. Requester receives the accepted notification and can open:
   - `/spaces/:spaceId`
   - `/spaces/:spaceId/assets/:assetId`
   - the asset media preview or download URL
   - the Space WebSocket connection

## Negative Paths

1. Before approval, confirm requester receives `403 Access denied` from:
   - `GET /api/spaces/:spaceId`
   - `GET /api/spaces/:spaceId/assets`
   - `GET /api/spaces/:spaceId/variants/:variantId/media`
   - `GET /api/spaces/:spaceId/ws`
2. Confirm unauthorized responses do not include the Space name, asset name, variant ID, or R2 media key.
3. Owner rejects a second requester. Confirm that user still cannot open REST, media, or WebSocket paths.
4. Owner revokes the approved requester. Confirm the requester immediately loses REST, media, and WebSocket access.
5. Confirm revocation sends the requester notification and does not remove the owner membership.

## Observability

- Filter worker logs for `SpaceSharing` and confirm entries exist for request creation, duplicate request reuse, approval, rejection, and member revocation.
- Confirm email failures, if any, are logged by `EmailService` or `NotificationEmailService` but do not roll back sharing mutations.
