# Implementation Workflow

You are implementing a Linear issue in this repository.

## Before coding

1. Read the Linear issue and `AGENTS.md`.
2. Inspect the touched route, worker, sync path, DAO, or frontend surface directly.
3. Choose the smallest change that makes the issue correct.

## While implementing

- Keep multi-user sync, asset lifecycle, and billing behavior coherent.
- Add or update tests for behavior changes.
- Treat auth, billing, DB migrations, Wrangler config, and dependency changes as approval-needed unless the issue clearly calls for them.
- Fix root causes instead of patching symptoms.

## Verification

Start with the narrowest useful checks, then widen when the touched surface requires it.

- General code changes:
  `npm run typecheck && npm run lint && npm test`
- Frontend or route changes:
  `npm run build`
- Schema changes:
  `npm run db:migrate`

## Before finishing

- Make sure the relevant verification is green.
- If you are working manually, push the branch and open or update the PR with an explicit summary.
