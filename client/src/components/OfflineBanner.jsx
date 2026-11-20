import { useEffect, useState } from 'react';

/** Shows a bar while the device has no network. Data is never served from a local cache (see vite.config.js). */
export default function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed bottom-0 inset-x-0 z-[60] bg-red-900 text-red-100 text-sm text-center px-4 py-2">
      You are offline. Estatium needs a connection to show live data. Emergency calls to your guard or admin should be made by phone.
    </div>
  );
}
