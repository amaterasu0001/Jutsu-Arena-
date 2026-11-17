import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

import { ApiError, errorMessage } from '@/services/api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  reload: () => Promise<void>;
  setData: (value: T) => void;
}

/** Load data from the API with loading / error state and a manual reload. */
export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    const call = (latest.current += 1);
    try {
      const result = await fetcherRef.current();
      if (call !== latest.current) return;
      setData(result);
      setError(null);
      setOffline(false);
    } catch (failure) {
      if (call !== latest.current) return;
      setError(errorMessage(failure));
      setOffline(failure instanceof ApiError && failure.offline);
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    return () => {
      latest.current += 1; // ignore a response that arrives after unmount / dep change
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, offline, reload, setData };
}
