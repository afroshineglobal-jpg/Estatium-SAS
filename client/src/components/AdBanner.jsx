import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import api from '../utils/api';

/**
 * Sponsored banner shown under the header to every signed-in user. Ads are managed ONLY from the Platform console;
 * there is no menu entry. Several ads rotate every 8 seconds; the user can hide the banner until the next visit.
 */
export default function AdBanner() {
  const [ads, setAds] = useState([]);
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('estatium_ad_hidden') === '1'; } catch { return false; } });
  const seen = useRef(new Set());

  useEffect(() => { if (!hidden) api.get('/advertisements', { params: { placement: 'HOME' } }).then((r) => setAds(Array.isArray(r) ? r : [])).catch(() => {}); }, [hidden]);
  useEffect(() => { if (ads.length < 2) return undefined; const t = setInterval(() => setI((x) => (x + 1) % ads.length), 8000); return () => clearInterval(t); }, [ads.length]);

  const ad = ads[i % (ads.length || 1)];
  useEffect(() => { if (ad && !seen.current.has(ad.id)) { seen.current.add(ad.id); api.post(`/advertisements/${ad.id}/impression`).catch(() => {}); } }, [ad?.id]);

  if (hidden || !ad) return null;
  const open = () => { api.post(`/advertisements/${ad.id}/click`).catch(() => {}); if (ad.linkUrl) window.open(ad.linkUrl, '_blank', 'noopener,noreferrer'); };
  const hide = () => { try { sessionStorage.setItem('estatium_ad_hidden', '1'); } catch { /* ignore */ } setHidden(true); };

  return (
    <div className="mb-4" aria-label="Sponsored">
      <div>
        <div className="card relative overflow-hidden border-estate-800/40">
          <button onClick={open} className={`block w-full text-left ${ad.linkUrl ? 'cursor-pointer' : 'cursor-default'}`}>
            {ad.imageUrl && <img src={ad.imageUrl} alt={ad.title} className="w-full max-h-40 object-cover" loading="lazy" />}
            {(!ad.imageUrl || ad.content) && (
              <div className="p-3 pr-10">
                <p className="font-semibold text-slate-100 text-sm">{ad.title}</p>
                {ad.content && <p className="text-xs text-slate-400 mt-0.5">{ad.content}</p>}
                {ad.advertiserName && <p className="text-[11px] text-slate-500 mt-0.5">— {ad.advertiserName}</p>}
              </div>
            )}
          </button>
          <span className="absolute top-1.5 left-1.5 text-[10px] uppercase tracking-wide bg-black/60 text-slate-300 rounded px-1.5 py-0.5">Ad</span>
          <button onClick={hide} aria-label="Hide banner" className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-slate-200 rounded-full p-1"><X size={14} /></button>
        </div>
      </div>
    </div>
  );
}
