# Review Workflow

You are reviewing the implementation branch for a Linear issue.

## What to check

1. Read the Linear issue and confirm the diff matches the requested scope.
2. Review the current head only.
3. Focus on regressions in sync behavior, asset lifecycle, billing, auth, and worker boundaries.
4. Make sure changed behavior has appropriate tests.

## Verification

- General code changes:
  `npm run typecheck && npm run lint && npm test`
- Frontend or route changes:
  `npm run build`
- Schema changes:
  `npm run db:migrate`

## Review outcome

- Approve when the change is in scope, verified, and free of meaningful regressions.
- Request changes when the current head still has a concrete correctness, regression, or policy problem.
