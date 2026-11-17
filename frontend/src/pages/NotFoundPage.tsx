import { Compass, Home } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { Page } from '@/layouts/AppLayout';

export default function NotFoundPage() {
  return (
    <Page className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <Compass className="mx-auto h-10 w-10 text-accent-soft" aria-hidden />
        <p className="eyebrow mt-5 !text-accent-soft">404</p>
        <h1 className="mt-2 text-3xl font-bold uppercase">This path leads nowhere</h1>
        <p className="mx-auto mt-3 max-w-md text-fg-muted">The page you were looking for does not exist. Head back and pick a route from the menu.</p>
        <div className="mt-6 flex justify-center">
          <ButtonLink to="/" variant="primary" icon={Home}>
            Back to home
          </ButtonLink>
        </div>
      </div>
    </Page>
  );
}
