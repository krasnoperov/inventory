import { createFileRoute } from '@tanstack/react-router';
import PricingPage from '../pages/PricingPage';

const DESCRIPTION =
  'Make Effects pricing for managed AI generation and BYOK platform workflows.';

export const Route = createFileRoute('/pricing')({
  head: () => ({
    meta: [
      { title: 'Pricing | Make Effects' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: 'Make Effects Pricing' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: 'https://makefx.app/pricing' },
      { name: 'twitter:title', content: 'Make Effects Pricing' },
      { name: 'twitter:description', content: DESCRIPTION },
    ],
    links: [
      { rel: 'canonical', href: 'https://makefx.app/pricing' },
    ],
  }),
  component: PricingPage,
});
