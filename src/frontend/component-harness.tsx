import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from './components/AppHeader';
import { Pagination } from './components/Pagination';
import './styles/theme.css';
import './styles/global.css';

declare global {
  interface Window {
    __componentHarnessCalls?: string[];
    __setHarnessProps?: (props: Record<string, unknown>) => void;
  }
}

const registry: Record<string, ComponentType<Record<string, unknown>>> = {
  AppHeader: AppHeader as ComponentType<Record<string, unknown>>,
  Pagination: Pagination as unknown as ComponentType<Record<string, unknown>>,
};

function revive(value: unknown): unknown {
  if (value === '__noop__') {
    return () => {};
  }

  if (typeof value === 'string' && value.startsWith('__record__:')) {
    const eventName = value.slice('__record__:'.length);
    return () => {
      window.__componentHarnessCalls = [...(window.__componentHarnessCalls ?? []), eventName];
    };
  }

  if (Array.isArray(value)) {
    return value.map(revive);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, revive(entry)]),
    );
  }

  return value;
}

function readProps(searchParams: URLSearchParams): Record<string, unknown> {
  const encoded = searchParams.get('props');
  if (!encoded) {
    return {};
  }

  const json = atob(decodeURIComponent(encoded));
  return revive(JSON.parse(json)) as Record<string, unknown>;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

const root = createRoot(rootElement);
const searchParams = new URLSearchParams(window.location.search);
const componentName = searchParams.get('component') ?? '';
const Component = registry[componentName];

if (!Component) {
  throw new Error(`Unknown component: ${componentName}`);
}

function render(props: Record<string, unknown>) {
  root.render(
    <StrictMode>
      <div data-testid="harness-root">
        <Component {...props} />
      </div>
    </StrictMode>,
  );
}

window.__componentHarnessCalls = [];
window.__setHarnessProps = (props) => render(revive(props) as Record<string, unknown>);

render(readProps(searchParams));
