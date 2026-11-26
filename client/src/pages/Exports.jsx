import { useState } from 'react';
import { downloadCsv } from '../utils/download';

const Card = ({ title, text, children }) => (
  <div className="card p-4 space-y-2"><div><p className="text-slate-100 font-medium">{title}</p><p className="text-xs text-slate-500">{text}</p></div>{children}</div>
);

/** Records & Exports: the estate's history stays in the system; this page extracts it as CSV files (open in Excel). */
export default function Exports() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [rs, setRs] = useState('all');
  const dates = (
    <div className="flex gap-2 items-end flex-wrap">
      <div><label className="label">From</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
    </div>
  );
  return (
    <div className="space-y-4 animate-fade-in">
      <div><h1 className="page-title">Records &amp; Exports</h1><p className="text-slate-500 text-sm">Nothing is ever deleted when someone moves out or leaves. Download any history here as a spreadsheet (CSV). Times are in UTC. Every download is logged.</p></div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Residents" text="Everyone with their unit, move-in / move-out dates, family and vehicles.">
          <select className="select" value={rs} onChange={e => setRs(e.target.value)}><option value="all">All (living here and moved out)</option><option value="active">Living here</option><option value="vacated">Moved out</option></select>
          <button className="btn-primary" onClick={() => downloadCsv('/exports/residents.csv', { status: rs }, 'residents')}>Download residents</button>
        </Card>
        <Card title="Visitors" text="Every visitor with the resident visited, entry and exit times and any guest vehicle.">
          {dates}
          <div className="flex gap-2 flex-wrap"><button className="btn-primary" onClick={() => downloadCsv('/exports/visitors.csv', { from, to }, 'visitors')}>Download visitors</button>
            <button className="btn-secondary" onClick={() => downloadCsv('/exports/visitors.csv', { from, to, vehiclesOnly: 1 }, 'guest-vehicles')}>Guest vehicles only</button></div>
        </Card>
        <Card title="Resident vehicle movements" text="Every entry and exit of registered resident vehicles at the gate.">
          {dates}
          <button className="btn-primary" onClick={() => downloadCsv('/exports/vehicle-movements.csv', { from, to }, 'vehicle-movements')}>Download vehicle in/out</button>
        </Card>
        <Card title="Staff" text="All staff and guards with status, reasons, leaving dates and attendance.">
          {dates}
          <div className="flex gap-2 flex-wrap"><button className="btn-primary" onClick={() => downloadCsv('/exports/staff.csv', {}, 'staff')}>Download staff list</button>
            <button className="btn-secondary" onClick={() => downloadCsv('/exports/staff-attendance.csv', { from, to }, 'staff-attendance')}>Download attendance</button></div>
        </Card>
      </div>
      <p className="text-xs text-slate-500">For one person's history, open them on the Residents or Staff page and use the download buttons there.</p>
    </div>
  );
}
