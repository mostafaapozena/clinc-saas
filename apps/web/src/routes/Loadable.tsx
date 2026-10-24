import { Suspense, type ReactNode } from 'react';
import { Loading } from '../components/ui';

/** Shows a loading state while a lazily loaded page's code arrives. */
export function Loadable({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="full-page">
          <Loading />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
