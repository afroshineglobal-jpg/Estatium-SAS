import api from './api';

/** Downloads an invoice PDF (works for the resident who owns it and for finance staff). */
export async function downloadInvoice(b) {
  try {
    const blob = await api.get(`/billing/${b.id}/invoice.pdf`, { responseType: 'blob', timeout: 30000 });
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${b.invoiceNo || 'invoice'}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { /* api shows the error */ }
}
