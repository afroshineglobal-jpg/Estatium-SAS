import { createContext, useContext, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { playSound, startRing, stopRing } from '../utils/sounds';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const socket = io('/', { transports: ['websocket', 'polling'], auth: { token: localStorage.getItem('token') } });
    socketRef.current = socket;

    socket.emit('join-room', 'general');          // user / role / estate rooms are joined server-side from the verified token

    socket.on('emergency-alert', (data) => {
      playSound('EMERGENCY');
      toast.error(`🚨 EMERGENCY: ${data.report?.type} — ${data.report?.description || ''}`, {
        duration: 10000, position: 'top-center',
        style: { background: '#7f1d1d', color: '#fca5a5', border: '1px solid #991b1b', fontWeight: 600 }
      });
    });

    socket.on('new-notice', (notice) => {
      playSound('MESSAGE');
      toast(`📢 ${notice.title}`, { duration: 5000, icon: '📌' });
    });

    // Visitor at the gate (resident) and the resident's decision (guards): doorbell
    socket.on(`resident-${user.id}`, (d) => { if (d?.type === 'VISITOR_WAITING') startRing(d.visitor?.id); });
    socket.on('visitor-decision', (d) => { if (user.role === 'RESIDENT' || d?.entryCode !== undefined) stopRing(d?.visitorId); });
    socket.on('visitor-decision', () => { if (['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role)) playSound('VISITOR'); });
    socket.on('new-message', (m) => { if (m?.senderId !== user.id) playSound('MESSAGE'); });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={socketRef}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
