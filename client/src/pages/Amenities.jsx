import { useState, useEffect } from 'react';
import { Plus, CalendarRange, Settings, ChevronLeft, ChevronRight, Clock, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { fmt, symbol } from '../utils/money';

// ── HELPERS ──────────────────────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(year, month) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return { first, days };
}

function toYMD(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── ADD AMENITY MODAL ─────────────────────────────────────────────────────────
function AddAmenityModal({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', description: '', capacity: '', pricePerHour: '' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.name) return toast.error('Amenity name required');
    setLoading(true);
    try {
      await api.post('/amenities', form);
      toast.success(`${form.name} added`);
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Add Amenity</h3>
        <div className="space-y-3">
          <div><label className="label">Amenity Name *</label>
            <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Rooftop Lounge" autoFocus />
          </div>
          <div><label className="label">Description</label>
            <textarea className="input resize-none h-16" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Capacity (people)</label>
              <input type="number" className="input" value={form.capacity} onChange={e => setForm({...form, capacity: e.target.value})} placeholder="e.g. 30" min="1" />
            </div>
            <div><label className="label">Price per Hour ({symbol()})</label>
              <input type="number" className="input" value={form.pricePerHour} onChange={e => setForm({...form, pricePerHour: e.target.value})} placeholder="0 = Free" min="0" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Adding...' : 'Add Amenity'}</button>
        </div>
      </div>
    </div>
  );
}

// ── EDIT AMENITY MODAL ────────────────────────────────────────────────────────
function EditAmenityModal({ amenity, onClose, onDone }) {
  const [form, setForm] = useState({
    name: amenity.name, description: amenity.description || '',
    capacity: amenity.capacity || '', pricePerHour: amenity.pricePerHour || '',
    isActive: amenity.isActive
  });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await api.put(`/amenities/${amenity.id}`, form);
      toast.success('Amenity updated');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Edit — {amenity.name}</h3>
        <div className="space-y-3">
          <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div><label className="label">Description</label><textarea className="input resize-none h-16" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Capacity</label><input type="number" className="input" value={form.capacity} onChange={e => setForm({...form, capacity: e.target.value})} /></div>
            <div><label className="label">Price/hr ({symbol()})</label><input type="number" className="input" value={form.pricePerHour} onChange={e => setForm({...form, pricePerHour: e.target.value})} /></div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-surface-900">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm({...form, isActive: e.target.checked})} className="w-4 h-4 accent-green-500" />
            <span className="text-sm text-slate-300">Active — visible to residents</span>
          </label>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── BOOKING CALENDAR MODAL ───────────────────────────────────────────────────
function BookingCalendarModal({ amenity, onClose, onDone }) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [busySlots, setBusySlots]       = useState([]);   // bookings for the selected date
  const [monthBookings, setMonthBookings] = useState([]);  // all bookings this month (for dots)
  const [form, setForm]   = useState({ startTime: '09:00', endTime: '10:00', notes: '' });
  const [loading, setLoading]   = useState(false);
  const [checking, setChecking] = useState(false);
  const [conflict, setConflict] = useState(null);

  // Load this month's bookings for dot indicators
  useEffect(() => {
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
    api.get(`/amenities/${amenity.id}/availability?month=${monthStr}`)
      .then(setMonthBookings).catch(() => {});
  }, [year, month, amenity.id]);

  // When a date is selected, filter busy slots for that day
  useEffect(() => {
    if (!selectedDate) { setBusySlots([]); setConflict(null); return; }
    const ymd = toYMD(selectedDate);
    setBusySlots(monthBookings.filter(b => toYMD(b.date) === ymd));
    setConflict(null);
  }, [selectedDate, monthBookings]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); setSelectedDate(null); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); setSelectedDate(null); };

  const { first, days } = getDaysInMonth(year, month);

  const checkConflict = () => {
    const { startTime, endTime } = form;
    if (!startTime || !endTime || endTime <= startTime) return false;
    return busySlots.find(b => b.startTime < endTime && b.endTime > startTime) || null;
  };

  const book = async () => {
    if (!selectedDate) return toast.error('Select a date first');
    if (form.endTime <= form.startTime) return toast.error('End time must be after start time');

    const c = checkConflict();
    if (c) { setConflict(c); return; }

    setLoading(true);
    try {
      await api.post('/amenities/bookings', {
        amenityId: amenity.id,
        date: toYMD(selectedDate),
        startTime: form.startTime,
        endTime: form.endTime,
        notes: form.notes
      });
      toast.success('Booking submitted — awaiting approval');
      onDone(); onClose();
    } catch (err) {
      // Backend overlap error
      if (err.response?.status === 409) {
        setConflict({ startTime: '—', endTime: '—', fromServer: true, message: err.response.data.error });
      }
    } finally { setLoading(false); }
  };

  const hours = form.startTime && form.endTime && form.endTime > form.startTime
    ? ((new Date(`2000-01-01T${form.endTime}`) - new Date(`2000-01-01T${form.startTime}`)) / 3600000).toFixed(1)
    : 0;
  const cost = amenity.pricePerHour ? amenity.pricePerHour * hours : 0;

  const today = new Date(); today.setHours(0,0,0,0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-0 max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold text-slate-100">Book — {amenity.name}</h3>
            <span className="text-sm text-estate-300">{amenity.pricePerHour ? `${fmt(amenity.pricePerHour)}/hr` : 'Free'}</span>
          </div>
          <p className="text-slate-500 text-xs">{amenity.description}</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Calendar */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <button className="btn-ghost p-1.5" onClick={prevMonth}><ChevronLeft size={16} /></button>
              <span className="text-sm font-semibold text-slate-200">{MONTHS[month]} {year}</span>
              <button className="btn-ghost p-1.5" onClick={nextMonth}><ChevronRight size={16} /></button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => <div key={d} className="text-center text-xs text-slate-600 font-medium py-1">{d}</div>)}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-0.5">
              {Array(first).fill(null).map((_, i) => <div key={`e${i}`} />)}
              {Array(days).fill(null).map((_, i) => {
                const dayDate = new Date(year, month, i + 1);
                const dayDate0 = new Date(dayDate); dayDate0.setHours(0,0,0,0);
                const isPast = dayDate0 < today;
                const ymd = toYMD(dayDate);
                const hasBusy = monthBookings.some(b => toYMD(b.date) === ymd);
                const isSelected = selectedDate && toYMD(selectedDate) === ymd;
                const isToday = toYMD(today) === ymd;

                return (
                  <button key={i} disabled={isPast}
                    onClick={() => !isPast && setSelectedDate(dayDate)}
                    className={`relative flex flex-col items-center justify-center h-9 rounded-lg text-sm font-medium transition-all
                      ${isPast ? 'text-slate-700 cursor-not-allowed' : 'hover:bg-estate-900/50 cursor-pointer'}
                      ${isSelected ? 'bg-estate-600 text-white' : ''}
                      ${isToday && !isSelected ? 'border border-estate-600 text-estate-300' : ''}
                      ${!isSelected && !isPast ? 'text-slate-300' : ''}
                    `}>
                    {i + 1}
                    {hasBusy && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400" />
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-600 mt-2 text-center">● Dates with existing bookings (may still have free slots)</p>
          </div>

          {/* Selected date details */}
          {selectedDate && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 py-2 border-t border-slate-800">
                <CalendarRange size={15} className="text-estate-400" />
                <span className="text-sm font-semibold text-slate-200">
                  {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
              </div>

              {/* Existing bookings for that day */}
              {busySlots.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Existing bookings</p>
                  {busySlots.map(b => (
                    <div key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-800/30">
                      <Clock size={13} className="text-amber-400 flex-shrink-0" />
                      <span className="text-xs font-mono text-amber-300">{b.startTime} – {b.endTime}</span>
                      <span className={`badge text-xs ml-auto ${b.status === 'APPROVED' ? 'badge-green' : 'badge-yellow'}`}>{b.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Time picker */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Time</label>
                  <input type="time" className="input" value={form.startTime}
                    onChange={e => { setForm({...form, startTime: e.target.value}); setConflict(null); }} />
                </div>
                <div>
                  <label className="label">End Time</label>
                  <input type="time" className="input" value={form.endTime}
                    onChange={e => { setForm({...form, endTime: e.target.value}); setConflict(null); }} />
                </div>
              </div>

              {/* Cost preview */}
              {hours > 0 && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-900 text-sm">
                  <span className="text-slate-400">{hours}hr{hours !== '1.0' ? 's' : ''}{amenity.pricePerHour ? ` × ${fmt(amenity.pricePerHour)}/hr` : ''}</span>
                  <span className="font-bold text-estate-300">{cost > 0 ? `${fmt(cost)}` : 'Free'}</span>
                </div>
              )}

              {/* Conflict warning */}
              {conflict && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-900/30 border border-red-800/40">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-300 text-sm font-semibold">Time slot conflict!</p>
                    <p className="text-red-400/80 text-xs mt-0.5">
                      {conflict.fromServer ? conflict.message : `There is already a booking from ${conflict.startTime} to ${conflict.endTime}. Please choose a different time.`}
                    </p>
                  </div>
                </div>
              )}

              <div><label className="label">Notes (optional)</label>
                <input className="input" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Any special requirements?" />
              </div>

              <button className="btn-primary w-full justify-center py-3" onClick={book} disabled={loading || !hours}>
                {loading ? 'Submitting...' : <><CalendarRange size={16} /> Request This Slot</>}
              </button>
            </div>
          )}

          {!selectedDate && (
            <p className="text-center text-slate-500 text-sm py-2">← Select a date to see availability and book</p>
          )}
        </div>

        <div className="px-5 pb-4">
          <button className="btn-secondary w-full justify-center" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function Amenities() {
  const { user } = useAuth();
  const [amenities, setAmenities]   = useState([]);
  const [bookings, setBookings]     = useState([]);
  const [allAmenities, setAllAmenities] = useState([]); // admin view including inactive
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('amenities');
  const [addModal, setAddModal]     = useState(false);
  const [editAmenity, setEditAmenity]       = useState(null);
  const [bookingAmenity, setBookingAmenity] = useState(null);

  const isAdmin    = user.role === 'ADMIN';
  const isResident = user.role === 'RESIDENT';

  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        api.get('/amenities'),
        api.get('/amenities/bookings')
      ]);
      setAmenities(a);
      setBookings(b);
      if (isAdmin) {
        api.get('/amenities/all').then(setAllAmenities).catch(() => setAllAmenities(a));
      }
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const displayAmenities = isAdmin ? allAmenities : amenities;
  const pendingCount = bookings.filter(b => b.status === 'PENDING').length;

  const updateBookingStatus = async (id, status) => {
    try {
      await api.put(`/amenities/bookings/${id}/status`, { status });
      toast.success(`Booking ${status.toLowerCase()}`);
      load();
    } catch {}
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Amenities</h1>
          <p className="text-slate-500 text-sm">{amenities.length} amenities · {pendingCount} pending bookings</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1">
            <button onClick={() => setTab('amenities')} className={`btn-${tab === 'amenities' ? 'primary' : 'secondary'} text-xs`}>Amenities</button>
            <button onClick={() => setTab('bookings')} className={`btn-${tab === 'bookings' ? 'primary' : 'secondary'} text-xs relative`}>
              Bookings
              {pendingCount > 0 && <span className="ml-1 bg-amber-500 text-white text-[10px] w-4 h-4 rounded-full inline-flex items-center justify-center">{pendingCount}</span>}
            </button>
          </div>
          {isAdmin && tab === 'amenities' && (
            <button className="btn-primary" onClick={() => setAddModal(true)}><Plus size={16} /> Add Amenity</button>
          )}
        </div>
      </div>

      {tab === 'amenities' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loading ? (
            <p className="text-slate-500 col-span-2 text-center py-10">Loading...</p>
          ) : displayAmenities.length === 0 ? (
            <div className="col-span-2 card p-10 text-center">
              <CalendarRange size={40} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 mb-3">No amenities added yet.</p>
              {isAdmin && <button className="btn-primary mx-auto" onClick={() => setAddModal(true)}><Plus size={16} /> Add First Amenity</button>}
            </div>
          ) : displayAmenities.map(a => (
            <div key={a.id} className={`card p-5 transition-all ${!a.isActive ? 'opacity-50' : 'hover:border-estate-700/50'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-100 text-base">{a.name}</p>
                  <p className="text-sm text-slate-400 mt-0.5 line-clamp-2">{a.description}</p>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <span className={`badge text-xs ${a.isActive ? 'badge-green' : 'badge-gray'}`}>{a.isActive ? 'Active' : 'Off'}</span>
                  {isAdmin && (
                    <button className="btn-ghost p-1.5 rounded-lg" onClick={() => setEditAmenity(a)}>
                      <Settings size={14} className="text-slate-500" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-400 mb-4">
                {a.capacity && <span className="flex items-center gap-1">👥 <span>Capacity: {a.capacity}</span></span>}
                <span className="font-semibold text-estate-300">{a.pricePerHour ? `${fmt(Number(a.pricePerHour))}/hr` : '🆓 Free'}</span>
              </div>
              {isResident && a.isActive && (
                <button className="btn-primary w-full justify-center" onClick={() => setBookingAmenity(a)}>
                  <CalendarRange size={16} /> View Calendar & Book
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'bookings' && (
        <div className="table-container overflow-x-auto">
          <table className="table min-w-full">
            <thead><tr>
              <th>Amenity</th>
              {isAdmin && <th>Resident</th>}
              <th>Date</th><th>Time Slot</th><th>Duration</th><th>Amount</th><th>Status</th>
              {isAdmin && <th>Action</th>}
            </tr></thead>
            <tbody>
              {bookings.length === 0 ? (
                <tr><td colSpan={isAdmin ? 8 : 6} className="text-center py-12 text-slate-500">No bookings yet</td></tr>
              ) : bookings.map(b => {
                const hrs = b.startTime && b.endTime
                  ? ((new Date(`2000T${b.endTime}`) - new Date(`2000T${b.startTime}`)) / 3600000).toFixed(1)
                  : '—';
                return (
                  <tr key={b.id}>
                    <td className="font-medium text-slate-200">{b.amenity?.name}</td>
                    {isAdmin && <td className="text-slate-400">{b.user?.name}</td>}
                    <td className="text-slate-400">{new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="font-mono text-sm text-slate-300">{b.startTime} – {b.endTime}</td>
                    <td className="text-slate-500 text-sm">{hrs}hr{hrs !== '1.0' ? 's' : ''}</td>
                    <td className="font-mono text-slate-300">{b.totalAmount ? `${fmt(b.totalAmount)}` : 'Free'}</td>
                    <td><span className={b.status === 'APPROVED' ? 'badge-green' : b.status === 'REJECTED' ? 'badge-red' : b.status === 'CANCELLED' ? 'badge-gray' : 'badge-yellow'}>{b.status}</span></td>
                    {isAdmin && (
                      <td>
                        {b.status === 'PENDING' && (
                          <div className="flex gap-1">
                            <button className="btn-ghost text-xs text-estate-400" onClick={() => updateBookingStatus(b.id, 'APPROVED')}>✓ Approve</button>
                            <button className="btn-ghost text-xs text-red-400" onClick={() => updateBookingStatus(b.id, 'REJECTED')}>✗</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addModal     && <AddAmenityModal onClose={() => setAddModal(false)} onDone={load} />}
      {editAmenity  && <EditAmenityModal amenity={editAmenity} onClose={() => setEditAmenity(null)} onDone={load} />}
      {bookingAmenity && <BookingCalendarModal amenity={bookingAmenity} onClose={() => setBookingAmenity(null)} onDone={load} />}
    </div>
  );
}
