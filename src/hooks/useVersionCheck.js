import { useState, useEffect, useRef } from 'react';

/**
 * Polls /index.html every `intervalMs` milliseconds (default: 5 minutes).
 * When Netlify deploys a new build, the ETag for index.html changes.
 * Returns true once a newer version is detected.
 */
export function useVersionCheck({ intervalMs = 5 * 60 * 1000 } = {}) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialEtag = useRef(null);

  useEffect(() => {
    const fetchEtag = async () => {
      try {
        const res = await fetch('/index.html', { cache: 'no-store', method: 'HEAD' });
        // Use ETag if present, fall back to Last-Modified
        return res.headers.get('etag') || res.headers.get('last-modified') || null;
      } catch {
        return null;
      }
    };

    let interval;

    fetchEtag().then((etag) => {
      if (!etag) return; // Can't detect version changes without ETag/Last-Modified
      initialEtag.current = etag;

      interval = setInterval(async () => {
        const current = await fetchEtag();
        if (current && current !== initialEtag.current) {
          setUpdateAvailable(true);
          clearInterval(interval);
        }
      }, intervalMs);
    });

    return () => clearInterval(interval);
  }, [intervalMs]);

  return updateAvailable;
}
