import { createSignal, onCleanup, onMount } from 'solid-js';

export function useNetworkStatus() {
  const [online, setOnline] = createSignal(navigator.onLine);

  const handleOnline = () => setOnline(true);
  const handleOffline = () => setOnline(false);

  onMount(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  });

  onCleanup(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  });

  return { online };
}
