import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Card, Empty, PageSkeleton } from './components/ui';
import { SettingsProvider } from './lib/settings';
import Overview from './pages/Overview';

const Project = lazy(() => import('./pages/Project'));
const Session = lazy(() => import('./pages/Session'));
const Search = lazy(() => import('./pages/Search'));
const Method = lazy(() => import('./pages/Method'));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function TitleSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const section = pathname.startsWith('/projects') ? 'Project' : pathname.startsWith('/sessions') ? 'Session' : pathname.startsWith('/search') ? 'Search' : pathname.startsWith('/method') ? 'Pricing & method' : 'Overview';
    document.title = `${section} · Turnbill`;
  }, [pathname]);
  return null;
}

/** Keeps a rendering bug on one page from blanking the whole app. */
class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card>
        <Empty title="Something went wrong on this page">
          <span className="font-mono text-[12px]">{this.state.error.message}</span>
          <div className="mt-3">
            <button className="underline" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </Empty>
      </Card>
    );
  }
}

function Routed() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/projects/:projectId" element={<Project />} />
          <Route path="/sessions/:sessionId" element={<Session />} />
          <Route path="/search" element={<Search />} />
          <Route path="/method" element={<Method />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function NotFound() {
  return (
    <Card>
      <Empty title="Page not found">
        <Link to="/" className="underline">
          Back to overview
        </Link>
      </Empty>
    </Card>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <ScrollToTop />
        <TitleSync />
        <Layout>
          <Routed />
        </Layout>
      </BrowserRouter>
    </SettingsProvider>
  );
}
