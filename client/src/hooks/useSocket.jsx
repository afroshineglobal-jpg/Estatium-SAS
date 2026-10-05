import { createContext, useContext, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';

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
      toast.error(`🚨 EMERGENCY: ${data.report?.type} — ${data.report?.description || ''}`, {
        duration: 10000, position: 'top-center',
        style: { background: '#7f1d1d', color: '#fca5a5', border: '1px solid #991b1b', fontWeight: 600 }
      });
    });

    socket.on('new-notice', (notice) => {
      toast(`📢 ${notice.title}`, { duration: 5000, icon: '📌' });
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={socketRef}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
