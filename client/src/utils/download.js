import api from './api';
import toast from 'react-hot-toast';

/** Downloads a CSV export (the request needs the login token, so a plain link cannot be used). */
export async function downloadCsv(path, params = {}, filename = 'export.csv') {
  try {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    const blob = await api.get(path, { params: clean, responseType: 'blob', timeout: 120000 });
    const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success('Download started');
  } catch { /* the api layer already showed the error */ }
}
