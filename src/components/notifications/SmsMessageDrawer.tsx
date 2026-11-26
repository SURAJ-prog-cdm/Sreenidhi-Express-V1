import React, { useState, useEffect } from 'react';
import { MessageSquare, Bell, X, CheckCheck, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { excelService } from '../../services/excelService';
import { formatIndianPhone } from './MobileAlertCard';

interface NotificationItem {
  id: number;
  ts: number;
  recipient_type: string;
  roll_number: string;
  phone_number: string;
  category: string;
  title: string;
  message: string;
  status: string;
  channel: string;
}

interface SmsMessageDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rollNumber: string;
  userType: 'STUDENT' | 'FACULTY' | 'PARENT';
  phoneNumber: string;
}

export const SmsMessageDrawer: React.FC<SmsMessageDrawerProps> = ({
  isOpen,
  onClose,
  rollNumber,
  userType,
  phoneNumber
}) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFeed = async () => {
    setLoading(true);
    try {
      const apiUserType = userType === 'FACULTY' ? 'STUDENT' : userType;
      const feed = await excelService.getNotificationFeed(rollNumber, apiUserType);
      setNotifications(feed);
    } catch (e) {
      console.error('Failed to load notifications feed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFeed();
    }
  }, [isOpen, rollNumber, userType]);

  if (!isOpen) return null;

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'TRIP_STARTED':
        return { label: 'Dispatched', bg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'APPROACHING_STOP':
        return { label: '5m ETA Warning', bg: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
      case 'BOARDED':
        return { label: 'Passenger Boarded', bg: 'bg-teal-500/20 text-teal-400 border-teal-500/30' };
      case 'DELAY':
        return { label: 'Traffic Delay', bg: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'CAMPUS_ARRIVED':
        return { label: 'Campus Arrival', bg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'EMERGENCY':
        return { label: 'Urgent Announcement', bg: 'bg-red-500/20 text-red-400 border-red-500/30' };
      default:
        return { label: 'Transit Notice', bg: 'bg-slate-700 text-slate-300 border-slate-600' };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md h-full bg-[#141820] border-l border-[#262C36] shadow-2xl flex flex-col text-[#E5E8EC]">
        {/* Drawer Header */}
        <div className="p-4 bg-[#181C24] border-b border-[#262C36] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#0D4B42]/50 border border-[#10B981]/40 flex items-center justify-center text-[#10B981]">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-1.5">
                <span>Sreenidhi Express SMS Feed</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.2 rounded border border-emerald-600/30">
                  LIVE
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                To: <strong className="text-white font-mono">{formatIndianPhone(phoneNumber) || '+91 98765 43210'}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={fetchFeed}
              disabled={loading}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#222834] transition-colors"
              title="Refresh messages"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#222834] transition-colors"
              title="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Message Feed Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#0F1217]">
          {notifications.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Bell className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-xs text-slate-400">No recent notifications yet.</p>
              <p className="text-[11px] text-slate-500">Trip updates and delay alerts will appear here in real time.</p>
            </div>
          ) : (
            notifications.map((n) => {
              const badge = getCategoryBadge(n.category);
              const dateStr = new Date(n.ts).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div
                  key={n.id}
                  className="p-3.5 rounded-xl bg-[#181C24] border border-[#262C36] shadow-md space-y-2 hover:border-emerald-500/30 transition-all"
                >
                  {/* Sender & Badge */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white font-mono tracking-tight text-[11px] bg-slate-800 px-1.5 py-0.5 rounded">
                        SREENIDHI-EXP
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                        {badge.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">{dateStr}</span>
                  </div>

                  {/* Title & Body */}
                  <div>
                    <h5 className="text-xs font-bold text-emerald-300 mb-1">{n.title}</h5>
                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{n.message}</p>
                  </div>

                  {/* Delivery Status */}
                  <div className="pt-2 border-t border-[#222834] flex items-center justify-between text-[10px] text-slate-400">
                    <span className="text-slate-400 font-mono">Channel: {n.channel || 'In-App SMS'}</span>
                    {n.status === 'FAILED' ? (
                      <span className="flex items-center text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span>Delivery Failed</span>
                      </span>
                    ) : n.status === 'PENDING' ? (
                      <span className="flex items-center text-amber-400">
                        <Clock className="w-3.5 h-3.5 mr-1" />
                        <span>Queued</span>
                      </span>
                    ) : (
                      <span className="flex items-center text-emerald-400">
                        <CheckCheck className="w-3.5 h-3.5 mr-1" />
                        <span>Confirmed Delivered</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer simulation indicator */}
        <div className="p-3 bg-[#181C24] border-t border-[#262C36] text-[11px] text-slate-400 flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Real-time Transit Alert Gateway</span>
          </span>
          <span className="font-mono text-emerald-400">Sreenidhi Express v2.5</span>
        </div>
      </div>
    </div>
  );
};
