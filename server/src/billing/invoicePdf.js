'use strict';
/** Builds a one-page PDF invoice with pdfkit. Standard fonts have no currency symbols, so amounts are printed as "NGN 15,000.00". */
const PDFDocument = require('pdfkit');

const money = (v, cur) => `${cur} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function logoBuffer(dataUri) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUri || ''); if (!m) return null;
  try { return Buffer.from(m[2], 'base64'); } catch { return null; }
}

/** inv = { estate:{name,address,logo}, bill, resident:{name,unit,email}, payments:[], footer, payTo } -> Promise<Buffer> */
function render(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${inv.bill.invoiceNo || ''}`, Author: inv.estate.name } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const cur = inv.bill.currency; const W = doc.page.width - 96; let y = 48;

    const logo = logoBuffer(inv.estate.logo);
    let textX = 48;
    if (logo) { try { doc.image(logo, 48, y, { fit: [70, 70] }); textX = 130; } catch { /* unreadable image: skip */ } }
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(16).text(inv.estate.name, textX, y, { width: W - 180 });
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(inv.estate.address || '', textX, doc.y + 2, { width: W - 180 });
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f766e').text('INVOICE', 48, y, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#333').text(inv.bill.invoiceNo || '', 48, y + 28, { width: W, align: 'right' });
    doc.text(`Issued: ${day(inv.bill.createdAt)}`, 48, y + 42, { width: W, align: 'right' });
    doc.text(`Due: ${day(inv.bill.dueDate)}`, 48, y + 56, { width: W, align: 'right' });

    y = 140; doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#ddd').stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#777').text('BILL TO', 48, y + 10);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(inv.resident.name || '', 48, y + 24);
    doc.font('Helvetica').fontSize(10).fillColor('#444').text([inv.resident.unit, inv.resident.email].filter(Boolean).join('  |  '), 48, doc.y + 1);
    const status = inv.bill.status; doc.font('Helvetica-Bold').fontSize(11).fillColor(status === 'PAID' ? '#15803d' : status === 'OVERDUE' ? '#b91c1c' : '#b45309').text(status, 48, y + 24, { width: W, align: 'right' });

    y = 215; doc.rect(48, y, W, 22).fill('#f1f5f9'); doc.fillColor('#333').font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', 56, y + 7).text('AMOUNT', 48, y + 7, { width: W - 8, align: 'right' });
    y += 30; doc.font('Helvetica').fontSize(10).fillColor('#111').text(inv.bill.title, 56, y, { width: W - 150 });
    if (inv.bill.description) doc.fontSize(9).fillColor('#666').text(inv.bill.description, 56, doc.y + 2, { width: W - 150 });
    doc.fontSize(10).fillColor('#111').text(money(inv.bill.subtotal ?? inv.bill.amount, cur), 48, y, { width: W - 8, align: 'right' });

    y = Math.max(doc.y + 14, y + 40); doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#ddd').stroke(); y += 10;
    const row = (label, value, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#111').text(label, 300, y, { width: 140 }).text(value, 48, y, { width: W - 8, align: 'right' }); y += bold ? 22 : 16; };
    row('Subtotal', money(inv.bill.subtotal ?? inv.bill.amount, cur));
    for (const t of inv.bill.taxLines || []) row(`${t.name} (${t.rate}%)`, money(t.amount, cur));
    row('Total', money(inv.bill.amount, cur), true);
    row('Paid', money(inv.bill.amountPaid, cur));
    row('Balance due', money(Number(inv.bill.amount) - Number(inv.bill.amountPaid), cur), true);

    if (inv.payments?.length) {
      y += 8; doc.font('Helvetica-Bold').fontSize(9).fillColor('#777').text('PAYMENTS', 48, y); y += 14;
      for (const p of inv.payments) { doc.font('Helvetica').fontSize(9).fillColor('#333').text(`${day(p.paidAt)}  ${String(p.method).replace('_', ' ')}${p.reference ? `  ref ${p.reference}` : ''}`, 48, y).text(money(p.amount, cur), 48, y, { width: W, align: 'right' }); y += 13; }
    }
    if (inv.payTo) { y += 12; doc.font('Helvetica-Bold').fontSize(9).fillColor('#777').text('HOW TO PAY', 48, y); doc.font('Helvetica').fontSize(9).fillColor('#333').text(inv.payTo, 48, y + 12, { width: W }); y = doc.y; }
    if (inv.footer) doc.font('Helvetica').fontSize(9).fillColor('#666').text(inv.footer, 48, doc.page.height - 90, { width: W, align: 'center' });
    doc.end();
  });
}

module.exports = { render };
