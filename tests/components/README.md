# Component Tests

Playwright-based tests render React components in a lightweight Vite harness.

```bash
pnpm test:components
CAPTURE_SCREENSHOTS=1 pnpm test:components
```

Screenshots are written to `test-results/components/screenshots/` when
`CAPTURE_SCREENSHOTS=1` is set. Playwright still captures failure screenshots
and traces automatically.

Register components in `src/frontend/component-harness.tsx`, then mount them
from specs with `mountComponent(page, 'ComponentName', props)`.

Callback props support two sentinels:

- `__noop__` becomes an empty function.
- `__record__:eventName` records `eventName` in `window.__componentHarnessCalls`.
