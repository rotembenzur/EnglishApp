import { useEffect, useState, type DependencyList } from 'react';
import { useApp } from './app';

/**
 * Run an async loader and re-run it when deps change or when local data changes
 * (answers, sync pulls). Returns undefined until the first result.
 */
export function useLive<T>(load: () => Promise<T>, deps: DependencyList): T | undefined {
  const version = useApp((s) => s.version);
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    load().then(
      (v) => alive && setValue(v),
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return value;
}
