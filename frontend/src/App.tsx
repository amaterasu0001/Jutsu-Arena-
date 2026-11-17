import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { BackendProvider } from '@/context/BackendContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { ToastProvider } from '@/context/ToastContext';
import { AppLayout, Page } from '@/layouts/AppLayout';
import HomePage from '@/pages/HomePage';
import NotFoundPage from '@/pages/NotFoundPage';

// Camera-heavy pages are split out so the landing page stays light.
const ArenaPage = lazy(() => import('@/pages/ArenaPage'));
const JutsuLibraryPage = lazy(() => import('@/pages/JutsuLibraryPage'));
const HandSignsPage = lazy(() => import('@/pages/HandSignsPage'));
const TrainingPage = lazy(() => import('@/pages/TrainingPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

function PageFallback() {
  return (
    <Page>
      <div className="skeleton h-10 w-72" />
      <div className="skeleton mt-6 h-[420px]" />
    </Page>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BackendProvider>
        <SettingsProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<HomePage />} />
                <Route path="play" element={<ArenaPage />} />
                <Route path="jutsu" element={<JutsuLibraryPage />} />
                <Route path="signs" element={<HandSignsPage />} />
                <Route path="training" element={<TrainingPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </SettingsProvider>
      </BackendProvider>
    </ToastProvider>
  );
}
