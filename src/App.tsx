import { lazy, Suspense, useEffect } from 'react';
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
    document.title = `${section} · Tokenscope`;
  }, [pathname]);
  return null;
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
        </Layout>
      </BrowserRouter>
    </SettingsProvider>
  );
}
