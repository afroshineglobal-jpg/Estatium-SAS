import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { unlockAudio, stopAlarm, alarmActive } from '../utils/sounds';
import { listenForPushSounds, pushPermission } from '../utils/push';

/** Global: unlocks audio on the first tap, shows the red "silence the alarm" bar during an SOS, and wires push sounds. */
export default function AlertSounds() {
  const { user } = useAuth();
  const [alarm, setAlarm] = useState(alarmActive());
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    const state = (e) => setAlarm(!!e.detail);
    let warned = false;
    const blocked = () => { if (!warned) { warned = true; toast('Tap anywhere on the screen to turn alert sounds on.', { icon: '🔊', duration: 6000 }); } };
    window.addEventListener('alarm-state', state); window.addEventListener('sound-blocked', blocked);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('alarm-state', state); window.removeEventListener('sound-blocked', blocked); };
  }, []);
  useEffect(() => { if (user && pushPermission() === 'granted') listenForPushSounds(); }, [user?.id]);
  if (!alarm) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[80] bg-red-700 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-xl animate-pulse">
      <p className="font-bold">🚨 EMERGENCY ALERT — check the Emergency page</p>
      <button className="bg-white text-red-700 font-bold rounded-lg px-4 py-1.5" onClick={stopAlarm}>Silence alarm</button>
    </div>
  );
}
