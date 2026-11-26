import React, { useState, useEffect } from 'react';
import { Smartphone, Bell, Check, Send } from 'lucide-react';
import { excelService } from '../../services/excelService';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';

export function formatIndianPhone(raw?: string | null): string {
  if (!raw) return 'Not Configured';
  const digits = String(raw).replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length === 10) {
    return `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
  }
  return raw;
}

interface MobileAlertCardProps {
  userType: 'STUDENT' | 'FACULTY' | 'PARENT';
  rollNumber: string;
  phoneNumber: string;
  isVerified: boolean;
  onOpenPhoneModal: () => void;
  onNotificationSent?: () => void;
}

export const MobileAlertCard: React.FC<MobileAlertCardProps> = ({
  userType,
  rollNumber,
  phoneNumber,
  isVerified,
  onOpenPhoneModal,
  onNotificationSent
}) => {
  const { activeBus, pushToast } = useCommuteSimulation();
  const [pushStatus, setPushStatus] = useState<string>('default');
  const apiUserType = userType === 'FACULTY' ? 'STUDENT' : userType;
  const [preferences, setPreferences] = useState({
    trip_started: true,
    approaching_stop: true,
    boarded: true,
    traffic_delay: true,
    campus_arrived: true,
    emergency_broadcast: true
  });
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    if ('Notification' in window) {
      setPushStatus(Notification.permission);
    }

    // Fetch saved preferences via authenticated service
    excelService.getNotificationPreferences(rollNumber, apiUserType)
      .then((prefs) => {
        if (prefs) {
          setPreferences({
            trip_started: Boolean(prefs.trip_started),
            approaching_stop: Boolean(prefs.approaching_stop),
            boarded: Boolean(prefs.boarded),
            traffic_delay: Boolean(prefs.traffic_delay),
            campus_arrived: Boolean(prefs.campus_arrived),
            emergency_broadcast: Boolean(prefs.emergency_broadcast)
          });
        }
      })
      .catch((e) => console.error('Failed to load preferences', e));
  }, [rollNumber, apiUserType]);

  const requestPushPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support desktop/mobile push notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    setPushStatus(permission);
    if (permission === 'granted') {
      try {
        const vapid = await excelService.getVapidPublicKey();
        if (vapid.enabled && vapid.publicKey && 'serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          if (reg && reg.pushManager) {
            // Convert base64 VAPID public key to Uint8Array
            const padding = '='.repeat((4 - (vapid.publicKey.length % 4)) % 4);
            const base64 = (vapid.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
              outputArray[i] = rawData.charCodeAt(i);
            }
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: outputArray,
            });
            await excelService.subscribePush(sub.toJSON());
            if (pushToast) {
              pushToast('success', 'Lockscreen Push Enabled', 'Device registered for real-time campus bus push notifications');
            }
          }
        }
      } catch (err) {
        console.warn('VAPID subscription fallback to local notifications:', err);
      }

      try {
        new Notification('Sreenidhi Express Alerts Activated', {
          body: 'You will receive real-time bus arrival & safety notifications directly on your device screen.',
          icon: '/sreenidhi_express_logo.jpg'
        });
      } catch { }
    }
  };

  const togglePreference = async (key: keyof typeof preferences) => {
    const updated = { ...preferences, [key]: !preferences[key] };
    setPreferences(updated);
    try {
      await excelService.saveNotificationPreferences(updated, rollNumber, apiUserType);
    } catch (e) {
      console.error('Failed to save preference', e);
    }
  };

  const handleSendTestNotification = () => {
    setTestSent(true);
    const busName = (activeBus as any)?.routeName || (activeBus as any)?.routeNumber || activeBus?.routeId || 'Route 14';
    const driverName = activeBus?.driverName || 'Designated Driver';
    const stopName = activeBus?.stops?.[activeBus.currentStopIndex]?.name || 'your pickup stop';
    const title = `⏱️ 5-Minute Warning: ${busName} Approaching`;
    const message = `${busName} is 5 mins away from ${stopName}. Driver: ${driverName}. Please proceed to the boarding bay.`;

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: message,
          icon: '/sreenidhi_express_logo.jpg',
        });
      } catch (err) {
        console.warn('Browser notification preview error:', err);
      }
    }

    if (pushToast) {
      pushToast('info', title, message);
    }

    if (onNotificationSent) onNotificationSent();
    setTimeout(() => setTestSent(false), 3000);
  };

  return (
    <div className="bg-[#181C24] border border-[#262C36] rounded-2xl p-5 shadow-lg text-[#E5E8EC]">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#262C36]">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-[#0D4B42]/50 border border-[#10B981]/40 flex items-center justify-center text-[#10B981]">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white flex items-center space-x-2">
              <span>{userType === 'PARENT' ? 'Parent Mobile Alert Center' : userType === 'FACULTY' ? 'Faculty Mobile Alert Center' : 'Student Mobile Alert Center'}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                E-Commerce Push
              </span>
            </h4>
            <p className="text-xs text-slate-400">
              Direct mobile SMS & lockscreen push notifications
            </p>
          </div>
        </div>

        {/* Registered phone badge */}
        <div className="flex items-center space-x-2">
          {phoneNumber ? (
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#11141A] border border-[#2A313D]">
              <span className="text-xs font-mono text-emerald-400 font-semibold">
                {formatIndianPhone(phoneNumber)}
              </span>
              <span className="flex items-center text-[10px] text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-600/40">
                <Check className="w-3 h-3 mr-0.5" /> {isVerified ? 'Verified' : 'Unverified'}
              </span>
              <button
                onClick={onOpenPhoneModal}
                className="text-xs text-slate-400 hover:text-white underline ml-1"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenPhoneModal}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-emerald-900/30 transition-all"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Register Mobile Number</span>
            </button>
          )}
        </div>
      </div>

      {/* Browser Push Notification Permission Banner */}
      <div className="mt-4 p-3.5 rounded-xl bg-[#11141A] border border-[#262C36] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white">Device / Lockscreen Push Notifications</div>
            <p className="text-[11px] text-slate-400">
              Receive pop-up alerts on phone or desktop when bus departs or nears your stop
            </p>
          </div>
        </div>
        <div>
          {pushStatus === 'granted' ? (
            <span className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30 flex items-center space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Push Active</span>
            </span>
          ) : (
            <button
              onClick={requestPushPermission}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors"
            >
              Enable Browser Push
            </button>
          )}
        </div>
      </div>

      {/* 6 E-Commerce Milestone Toggles */}
      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
          Transit Alert Milestones ({userType === 'PARENT' ? 'Guardian Alerts' : 'Passenger Alerts'})
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {[
            { key: 'trip_started', label: '🚀 Trip Dispatched', desc: 'Alert when morning bus departs terminus' },
            { key: 'approaching_stop', label: '⏱️ 5-Minute Stop Warning', desc: 'Heads-up alert before bus arrives at your stop' },
            {
              key: 'boarded',
              label: userType === 'FACULTY' ? '🎒 Faculty Boarded' : '🎒 Student Boarded',
              desc: userType === 'FACULTY' ? 'Confirmation when faculty safely steps onboard' : 'Confirmation when student safely steps onboard'
            },
            { key: 'traffic_delay', label: '⚠️ Highway Traffic Delays', desc: 'Real-time +10m/+20m delay announcements' },
            { key: 'campus_arrived', label: '🏫 Campus Arrival', desc: 'Safe arrival confirmation at SNIST gate' },
            { key: 'emergency_broadcast', label: '📢 Control Room Broadcasts', desc: 'Urgent announcements and weather notices' },
          ].map((item) => {
            const active = preferences[item.key as keyof typeof preferences];
            return (
              <div
                key={item.key}
                onClick={() => togglePreference(item.key as keyof typeof preferences)}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start justify-between space-x-2 ${
                  active
                    ? 'bg-[#151922] border-emerald-500/40'
                    : 'bg-[#11141A]/60 border-[#222834] opacity-60'
                }`}
              >
                <div>
                  <div className="text-xs font-bold text-white">{item.label}</div>
                  <div className="text-[11px] text-slate-400">{item.desc}</div>
                </div>
                <div
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 mt-0.5 ${
                    active ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      active ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Test Alert Action */}
      <div className="mt-4 pt-3 border-t border-[#222834] flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">
          Want to see how notifications appear on your phone?
        </span>
        <button
          onClick={handleSendTestNotification}
          disabled={testSent}
          className="px-3 py-1.5 rounded-lg bg-[#0D4B42] hover:bg-[#0F5A4F] text-emerald-200 text-xs font-semibold flex items-center space-x-1.5 border border-emerald-500/30 transition-all"
        >
          {testSent ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Test SMS Dispatched!</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Send Sample 5m Arrival SMS</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
