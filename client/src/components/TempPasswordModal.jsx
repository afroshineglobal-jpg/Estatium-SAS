import toast from 'react-hot-toast';

/** Shows a one-time temporary password to the admin. It cannot be shown again: they can always reset to get a new one. */
export default function TempPasswordModal({ email, password, onClose }) {
  const copy = () => navigator.clipboard.writeText(password).then(() => toast.success('Password copied'), () => toast.error('Copy failed — select it and copy by hand'));
  return (
    <div className="modal-overlay">
      <div className="modal p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-1">Temporary password</h3>
        <p className="text-sm text-slate-400 mb-3">Give this to <span className="text-slate-200">{email}</span>. They must choose a new password the first time they sign in.</p>
        <div className="flex gap-2 items-center">
          <input readOnly className="input font-mono text-estate-300" value={password} onFocus={(e) => e.target.select()} />
          <button className="btn-secondary" onClick={copy}>Copy</button>
        </div>
        <p className="text-xs text-amber-300 mt-3">This is shown only once. If it is lost, use "Reset password" again to create a new one.</p>
        <button className="btn-primary w-full mt-4 justify-center" onClick={onClose}>I have noted it</button>
      </div>
    </div>
  );
}
