import { useState } from 'react';
import { Upload, Download, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

const TEMPLATE = 'name,email,phone,block,unit,type\nChidi Okeke,chidi@example.com,+2348012345678,Block A,101,OWNER\nAmina Bello,amina@example.com,+2348098765432,Block A,102,TENANT\n';
// Spreadsheet programs run text starting with = + - @ as a formula: neutralise it when WRITING a CSV for Excel.
const cell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function download(name, text) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Excel on Windows often saves CSV as Windows-1252 rather than UTF-8: fall back so accents (ç, ü, ö) survive.
async function readText(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

export default function ImportResidentsModal({ onClose, onDone }) {
  const [csv, setCsv] = useState(''); const [fileName, setFileName] = useState('');
  const [createMissing, setCreateMissing] = useState(false);
  const [check, setCheck] = useState(null); const [done, setDone] = useState(null); const [busy, setBusy] = useState(false);

  const pick = async (ev) => {
    const f = ev.target.files?.[0]; if (!f) return;
    if (f.size > 300000) return toast.error('File too large. Import up to 150 residents at a time.');
    setCsv(await readText(f)); setFileName(f.name); setCheck(null); setDone(null);
  };
  const doCheck = async (cm = createMissing) => { setBusy(true); try { setCheck(await api.post('/residents/import/check', { csv, createMissing: cm })); } catch { /* interceptor toasts */ } finally { setBusy(false); } };
  const doImport = async () => {
    setBusy(true);
    try { const r = await api.post('/residents/import', { csv, createMissing }); setDone(r); toast.success(`${r.summary.created} resident(s) created`); onDone(); } catch { /* toast */ } finally { setBusy(false); }
  };
  const sheet = () => {
    const rows = done.rows.filter((r) => r.status === 'created');
    download(`resident-logins-${new Date().toISOString().slice(0, 10)}.csv`, ['name,email,block,unit,temporary_password', ...rows.map((r) => [r.name, r.email, r.block, r.unit, r.temporaryPassword].map(cell).join(','))].join('\n'));
  };
  const toggle = (v) => { setCreateMissing(v); if (check) doCheck(v); };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3"><h3 className="text-lg font-semibold text-slate-100">Import residents from CSV</h3><button className="ml-auto btn-ghost" onClick={onClose} aria-label="Close"><X size={16} /></button></div>

        {!done && <div className="space-y-3">
          <p className="text-sm text-slate-400">Columns: <b>name</b>, <b>email</b>, <b>unit</b> (required), phone, block, type (OWNER or TENANT). Up to 150 residents at a time. Each person needs a unique email, which is their login.</p>
          <div className="flex gap-2 flex-wrap items-center">
            <button className="btn-secondary" onClick={() => download('residents-template.csv', TEMPLATE)}><Download size={14} /> Download template</button>
            <label className="btn-secondary cursor-pointer"><Upload size={14} /> {fileName || 'Choose CSV file'}<input type="file" accept=".csv,text/csv" className="hidden" onChange={pick} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={createMissing} onChange={(e) => toggle(e.target.checked)} /> Create blocks and units that do not exist yet (counts towards your unit limit)</label>
          <button className="btn-primary" disabled={!csv || busy} onClick={() => doCheck()}>{busy && !check ? 'Checking…' : 'Check file'}</button>

          {check && <div className="space-y-2">
            <p className="text-sm"><b className="text-emerald-400">{check.summary.ok} ready</b>{check.summary.errors > 0 && <> · <b className="text-red-400">{check.summary.errors} with problems</b> (they will be skipped)</>}{check.summary.unitsToCreate > 0 && <> · {check.summary.unitsToCreate} will create new units</>}</p>
            <div className="table-container max-h-72 overflow-y-auto"><table className="table"><thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Block / unit</th><th>Result</th></tr></thead><tbody>
              {check.rows.map((r) => <tr key={r.line}><td className="text-xs text-slate-500">{r.line}</td><td className="text-sm">{r.name}</td><td className="text-sm">{r.email}</td><td className="text-sm">{r.block ? `${r.block} / ` : ''}{r.unit}</td>
                <td className="text-xs">{r.error ? <span className="text-red-400">{r.error}</span> : <span className="text-emerald-400">OK{r.willCreateUnit ? ' (new unit)' : ''}</span>}</td></tr>)}
            </tbody></table></div>
            <button className="btn-primary" disabled={busy || check.summary.ok === 0} onClick={doImport}>{busy ? 'Importing… this can take a moment' : `Import ${check.summary.ok} resident${check.summary.ok === 1 ? '' : 's'}`}</button>
          </div>}
        </div>}

        {done && <div className="space-y-3">
          <p className="text-sm"><b className="text-emerald-400">{done.summary.created} created</b>{done.summary.failed > 0 && <> · <b className="text-red-400">{done.summary.failed} not created</b></>}{done.summary.unitsCreated > 0 && <> · {done.summary.unitsCreated} new units</>}</p>
          {done.summary.created > 0 && <div className="rounded-lg border border-amber-700/60 bg-amber-900/30 p-3 text-sm text-amber-100">Temporary passwords are shown <b>only now</b>. Download the login sheet and hand each resident their own details privately. Everyone must set a new password at first sign-in.
            <div className="mt-2"><button className="btn-primary" onClick={sheet}><Download size={14} /> Download login sheet (CSV)</button></div></div>}
          {done.rows.some((r) => r.status === 'error') && <div className="table-container max-h-56 overflow-y-auto"><table className="table"><thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Problem</th></tr></thead><tbody>
            {done.rows.filter((r) => r.status === 'error').map((r) => <tr key={r.line}><td className="text-xs text-slate-500">{r.line}</td><td className="text-sm">{r.name}</td><td className="text-sm">{r.email}</td><td className="text-xs text-red-400">{r.error}</td></tr>)}</tbody></table></div>}
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>}
      </div>
    </div>
  );
}
