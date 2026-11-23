import { useEffect, useState } from 'react';
import api from '../utils/api';

const day = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const lastPaidDay = (expiresAt) => day(new Date(new Date(expiresAt).getTime() - 86400000));

/**
 * Subscription countdown for the estate (manual prepaid billing). Shown to everybody when action is needed:
 *   Due soon / Urgent -> amber notice, Grace -> warning with the date it turns read-only, Read-only -> red.
 * Hidden while the subscription is comfortably active. The countdown is computed on the server from dates.
 */
export default function PrepaidBanner() {
  const [p, setP] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/auth/me').then((me) => { if (live) setP(me?.tenant?.prepaid || null); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!p || p.state === 'ACTIVE' || p.state === 'APPROACHING' || p.state === 'UNPAID') return null;
  const base = 'text-sm px-4 py-2 text-center lg:ml-[var(--sidebar-width)] pt-[calc(var(--header-height)+0.5rem)]';
  const what = p.source === 'TRIAL' ? 'trial' : 'subscription';
  if (p.state === 'READ_ONLY') return <div role="alert" className={`${base} bg-red-900/70 text-red-100`}>This estate is in read-only mode: the {what} ended on {lastPaidDay(p.expiresAt)}. You can still view everything and send emergency alerts. Please ask your estate administrator to renew.</div>;
  if (p.state === 'GRACE') return <div role="alert" className={`${base} bg-amber-900/70 text-amber-100`}>The {what} ended on {lastPaidDay(p.expiresAt)}. Everything still works, but the estate becomes read-only on {day(p.readOnlyFrom)} ({p.graceDaysLeft} day{p.graceDaysLeft === 1 ? '' : 's'} left). Please renew.</div>;
  return <div className={`${base} ${p.state === 'URGENT' ? 'bg-amber-900/60 text-amber-100' : 'bg-blue-900/50 text-blue-100'}`}>The {what} runs until {lastPaidDay(p.expiresAt)} ({p.daysLeft} day{p.daysLeft === 1 ? '' : 's'} left). Please arrange renewal.</div>;
}
