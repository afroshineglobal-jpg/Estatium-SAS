'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Inv = require('../src/billing/invoice');

test('tax is added on top, per named tax, rounded to 2 dp', () => {
  const c = Inv.sanitize({ taxes: { AMENITY: [{ name: 'VAT', rate: 7.5 }, { name: 'Levy', rate: 1 }] } });
  const p = Inv.price(c, 'AMENITY', '10000.10');
  assert.equal(p.subtotal, '10000.1'); assert.equal(p.taxLines.length, 2); assert.equal(p.taxLines[0].amount, '750.01'); assert.equal(p.taxLines[1].amount, '100'); assert.equal(p.taxTotal, '850.01'); assert.equal(p.amount, '10850.11');
});
test('a category without tax is untouched and carries no tax lines', () => {
  const p = Inv.price(Inv.sanitize({}), 'MAINTENANCE', 15000);
  assert.equal(p.amount, '15000'); assert.equal(p.taxTotal, '0'); assert.equal(p.taxLines, undefined);
});
test('bill types map to a tax category', () => {
  assert.equal(Inv.CATEGORY_OF_TYPE.AMENITY, 'AMENITY'); assert.equal(Inv.CATEGORY_OF_TYPE.PENALTY, 'OTHER'); assert.equal(Inv.CATEGORY_OF_TYPE.MAINTENANCE, 'MAINTENANCE');
});
test('config validation: rates, counts, auto billing needs an amount, zero-rate taxes dropped', () => {
  assert.throws(() => Inv.sanitize({ taxes: { OTHER: [{ name: 'x', rate: 101 }] } }), /between 0 and 100/);
  assert.throws(() => Inv.sanitize({ taxes: { OTHER: [{ name: '', rate: 5 }] } }), /needs a name/);
  assert.throws(() => Inv.sanitize({ taxes: { OTHER: Array.from({ length: 6 }, (_, i) => ({ name: `t${i}`, rate: 1 })) } }), /At most 5/);
  assert.throws(() => Inv.sanitize({ monthly: { auto: true, amount: 0 } }), /amount/);
  assert.deepEqual(Inv.sanitize({ taxes: { REPAIR: [{ name: 'z', rate: 0 }] } }).taxes.REPAIR, []);
  const m = Inv.sanitize({ monthly: { auto: true, amount: 100, day: 99, dueDays: 0 } }).monthly; assert.equal(m.day, 28); assert.equal(m.dueDays, 1);
});
test('garbage stored config falls back to defaults instead of crashing', () => {
  assert.deepEqual(Inv.parse('{not json'), Inv.DEFAULTS()); assert.deepEqual(Inv.parse(undefined), Inv.DEFAULTS());
});
test('PDF invoice renders (with tax lines and payments)', async () => {
  const pdf = await require('../src/billing/invoicePdf').render({ estate: { name: 'Test Estate', address: 'Lagos', logo: null },
    bill: { invoiceNo: 'INV-2026-00001', createdAt: new Date(), dueDate: new Date(), status: 'PARTIAL', currency: 'NGN', title: 'Maintenance', subtotal: '1000', amount: '1075', amountPaid: '500', taxLines: [{ name: 'VAT', rate: 7.5, amount: '75' }] },
    resident: { name: 'Ada', unit: 'A-1', email: 'a@b.c' }, payments: [{ paidAt: new Date(), method: 'BANK_TRANSFER', amount: '500', reference: 'X1' }], footer: 'Thanks', payTo: 'Bank 123' });
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 1500);
});
test('migration 013: invoice columns, per-estate counter, trigger, unique number', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/013_invoices.sql'), 'utf8');
  for (const re of [/"invoiceNo"/, /"taxLines"\s+JSONB/, /CREATE TABLE IF NOT EXISTS "InvoiceCounter"/, /CREATE TRIGGER bill_invoice_no BEFORE INSERT ON "Bill"/, /SECURITY DEFINER/, /Bill_tenantId_invoiceNo_key/]) assert.match(sql, re);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i);
});
test('settings accept a logo only as PNG/JPEG data and keep it small', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/settings/settings.routes.js'), 'utf8');
  assert.match(src, /estate_logo/); assert.match(src, /png\|jpeg/); assert.match(src, /billing_config/);
});
