import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import api from '../utils/api';

/**
 * Sponsored banners, managed ONLY from the Platform console (no menu entry).
 *   <AdBanner position="TOP" />     under the page header
 *   <AdBanner position="BOTTOM" />  at the end of the page; several ads rotate every 8 seconds
 * An ad can be limited to chosen pages; the user can hide a slot until the next visit. GIFs animate as normal pictures.
 */
let cache = { at: 0, p: null };
const loadAds = () => { if (!cache.p || Date.now() - cache.at > 300000) { cache = { at: Date.now(), p: Promise.all([api.get('/advertisements', { params: { placement: 'TOP' } }), api.get('/advertisements', { params: { placement: 'BOTTOM' } })].map((x) => x.catch(() => []))) }; } return cache.p; };

export default function AdBanner({ position = 'TOP' }) {
  const { pathname } = useLocation();
  const key = `estatium_ad_hidden_${position}`;
  const [all, setAll] = useState([]);
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } });
  const seen = useRef(new Set());

  useEffect(() => { if (!hidden) loadAds().then(([top, bottom]) => { const list = position === 'TOP' ? top : bottom; setAll(Array.isArray(list) ? list : []); }); }, [hidden, position]);
  const ads = all.filter((a) => !a.pages || a.pages.split(',').includes(pathname));
  useEffect(() => { setI(0); }, [pathname]);
  useEffect(() => { if (ads.length < 2) return undefined; const t = setInterval(() => setI((x) => (x + 1) % ads.length), 8000); return () => clearInterval(t); }, [ads.length]);

  const ad = ads[i % (ads.length || 1)];
  useEffect(() => { if (ad && !seen.current.has(ad.id)) { seen.current.add(ad.id); api.post(`/advertisements/${ad.id}/impression`).catch(() => {}); } }, [ad?.id]);

  if (hidden || !ad) return null;
  const open = () => { api.post(`/advertisements/${ad.id}/click`).catch(() => {}); if (ad.linkUrl) window.open(ad.linkUrl, '_blank', 'noopener,noreferrer'); };
  const hide = () => { try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ } setHidden(true); };

  return (
    <div className={position === 'TOP' ? 'mb-4' : 'mt-6'} aria-label="Sponsored">
      <div className="card relative overflow-hidden border-estate-800/40">
        <button onClick={open} className={`block w-full text-left ${ad.linkUrl ? 'cursor-pointer' : 'cursor-default'}`}>
          {ad.imageUrl && <img src={ad.imageUrl} alt={ad.title} className="w-full max-h-40 object-cover" />}
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
        {ads.length > 1 && <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">{ads.map((a, k) => <span key={a.id} className={`w-1.5 h-1.5 rounded-full ${k === i % ads.length ? 'bg-white' : 'bg-white/40'}`} />)}</div>}
      </div>
    </div>
  );
}
