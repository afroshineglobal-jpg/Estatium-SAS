// Communication.jsx
import { useState, useEffect, useRef } from 'react';
import { Send, Pin, Plus, MessageSquare, BarChart3, Trash2 } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import toast from 'react-hot-toast';

export function Communication() {
  const { user } = useAuth();
  const socketRef = useSocket();
  const [tab, setTab] = useState('notices');
  const [notices, setNotices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [polls, setPolls] = useState([]);
  const [input, setInput] = useState('');
  const [room] = useState('general');
  const msgEnd = useRef(null);
  const [newNotice, setNewNotice] = useState({ title: '', content: '', isPinned: false });
  const [showNoticeForm, setShowNoticeForm] = useState(false);

  useEffect(() => {
    api.get('/communication/notices').then(setNotices).catch(() => {});
    api.get(`/communication/messages/${room}`).then(setMessages).catch(() => {});
    api.get('/communication/polls').then(setPolls).catch(() => {});
  }, []);

  useEffect(() => {
    msgEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;
    socket.on('new-message', (msg) => setMessages(prev => [...prev, msg]));
    socket.on('new-notice', (n) => setNotices(prev => [n, ...prev]));
    socket.emit('join-room', room);
    return () => { socket.off('new-message'); socket.off('new-notice'); };
  }, [socketRef?.current]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const content = input.trim();
    setInput('');
    try { await api.post('/communication/messages', { roomId: room, content }); }
    catch { setInput(content); }
  };

  const postNotice = async () => {
    if (!newNotice.title || !newNotice.content) return toast.error('Title and content required');
    try {
      const n = await api.post('/communication/notices', newNotice);
      setNotices(prev => [n, ...prev]);
      setNewNotice({ title: '', content: '', isPinned: false });
      setShowNoticeForm(false);
      toast.success('Notice posted');
    } catch {}
  };

  const vote = async (pollId, optionIndex) => {
    try {
      const updated = await api.post(`/communication/polls/${pollId}/vote`, { optionIndex });
      setPolls(prev => prev.map(p => p.id === pollId ? updated : p));
    } catch {}
  };

  const isAdmin = ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN'].includes(user.role);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Communication</h1>
        <div className="flex gap-1">
          {['notices', 'chat', 'polls'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`btn-${tab === t ? 'primary' : 'secondary'} text-xs px-3 capitalize`}>{t}</button>
          ))}
        </div>
      </div>

      {/* Notices */}
      {tab === 'notices' && (
        <div className="space-y-4">
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowNoticeForm(v => !v)}><Plus size={16} /> Post Notice</button>
          )}
          {showNoticeForm && (
            <div className="card p-4 space-y-3">
              <input className="input" placeholder="Notice title" value={newNotice.title} onChange={e => setNewNotice({...newNotice, title: e.target.value})} />
              <textarea className="input resize-none h-24" placeholder="Notice content..." value={newNotice.content} onChange={e => setNewNotice({...newNotice, content: e.target.value})} />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={newNotice.isPinned} onChange={e => setNewNotice({...newNotice, isPinned: e.target.checked})} />
                  Pin notice
                </label>
                <button className="btn-primary ml-auto" onClick={postNotice}>Post</button>
              </div>
            </div>
          )}
          {notices.map(n => (
            <div key={n.id} className={`card p-4 ${n.isPinned ? 'border-amber-800/40' : ''}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {n.isPinned && <Pin size={14} className="text-amber-400" />}
                  <p className="font-semibold text-slate-100">{n.title}</p>
                </div>
                <span className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="text-slate-300 text-sm leading-relaxed">{n.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chat */}
      {tab === 'chat' && (
        <div className="card flex flex-col" style={{ height: '60vh' }}>
          <div className="p-3 border-b border-slate-800 flex items-center gap-2">
            <MessageSquare size={16} className="text-estate-400" />
            <span className="text-sm font-medium text-slate-300">Community Chat — General</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map(m => {
              const isMe = m.senderId === user.id;
              return (
                <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${isMe ? 'bg-estate-700 text-white rounded-br-sm' : 'bg-surface-800 text-slate-200 rounded-bl-sm'}`}>
                    {!isMe && <p className="text-xs text-estate-400 mb-1 font-medium">{m.sender?.name}</p>}
                    <p>{m.content}</p>
                    <p className={`text-xs mt-1 ${isMe ? 'text-estate-300' : 'text-slate-500'}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              );
            })}
            <div ref={msgEnd} />
          </div>
          <div className="p-3 border-t border-slate-800 flex gap-2">
            <input className="input flex-1" placeholder="Type a message..." value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()} />
            <button className="btn-primary" onClick={sendMessage}><Send size={16} /></button>
          </div>
        </div>
      )}

      {/* Polls */}
      {tab === 'polls' && (
        <div className="space-y-4">
          {polls.map(p => {
            const totalVotes = Object.values(p.votes).reduce((s, v) => s + v.length, 0);
            return (
              <div key={p.id} className="card p-5">
                <p className="font-semibold text-slate-100 mb-4">{p.question}</p>
                <div className="space-y-2">
                  {p.options.map((opt, i) => {
                    const count = p.votes[i]?.length || 0;
                    const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
                    const voted = p.votes[i]?.includes(user.id);
                    return (
                      <button key={i} onClick={() => vote(p.id, i)}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${voted ? 'border-estate-600 bg-estate-900/40' : 'border-slate-700 hover:border-slate-600'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm text-slate-200">{opt}</span>
                          <span className="text-xs text-slate-400">{count} votes ({pct}%)</span>
                        </div>
                        <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                          <div className="h-full bg-estate-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-3">{totalVotes} total votes</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Communication;
