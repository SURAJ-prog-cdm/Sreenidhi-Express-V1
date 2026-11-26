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
        return { label: 'Dispatched', bg: 'bg-indigo-50 text-[#4F46E5] border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-700/40' };
      case 'APPROACHING_STOP':
        return { label: '5m ETA Warning', bg: 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-700/40' };
      case 'BOARDED':
        return { label: 'Passenger Boarded', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700/40' };
      case 'DELAY':
        return { label: 'Traffic Delay', bg: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700/40' };
      case 'CAMPUS_ARRIVED':
        return { label: 'Campus Arrival', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700/40' };
      case 'EMERGENCY':
        return { label: 'Urgent Announcement', bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700/40' };
      default:
        return { label: 'Transit Notice', bg: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/35 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md h-full bg-white/95 border-l border-indigo-100 shadow-2xl backdrop-blur-2xl flex flex-col text-slate-900 dark:bg-[#141821]/95 dark:border-[#2E3646] dark:text-slate-100">
        {/* Drawer Header */}
        <div className="p-4 bg-white/90 border-b border-slate-200/80 dark:bg-[#1E2430] dark:border-[#2E3646] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] flex items-center justify-center text-white shadow-xs">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center space-x-1.5">
                <span>Sreenidhi Express Feed</span>
                <span className="text-[10px] font-mono font-bold text-[#4F46E5] bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 dark:bg-indigo-950/60 dark:text-cyan-300 dark:border-cyan-700/40">
                  LIVE
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                To: <strong className="text-slate-900 dark:text-white font-mono">{formatIndianPhone(phoneNumber) || '+91 98765 43210'}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={fetchFeed}
              disabled={loading}
              className="p-2 rounded-xl text-slate-400 hover:text-[#4F46E5] hover:bg-indigo-50 dark:hover:text-white dark:hover:bg-[#2E3646] transition-colors cursor-pointer"
              title="Refresh messages"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-[#2E3646] transition-colors cursor-pointer"
              title="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Message Feed Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F7F9FF] dark:bg-[#0F1217]">
          {notifications.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Bell className="w-8 h-8 mx-auto text-indigo-300 dark:text-slate-600" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">No recent notifications yet.</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Trip updates and delay alerts will appear here in real time.</p>
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
                  className="prismatic-card p-3.5 rounded-2xl space-y-2"
                >
                  {/* Sender & Badge */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-[#4F46E5] dark:text-cyan-300 font-mono tracking-tight text-[11px] bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-lg">
                        SREENIDHI-EXP
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                        {badge.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">{dateStr}</span>
                  </div>

                  {/* Title & Body */}
                  <div>
                    <h5 className="text-xs font-extrabold text-slate-900 dark:text-cyan-200 mb-1">{n.title}</h5>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{n.message}</p>
                  </div>

                  {/* Delivery Status */}
                  <div className="pt-2 border-t border-slate-100 dark:border-[#2E3646] flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono">Channel: {n.channel || 'In-App SMS'}</span>
                    {n.status === 'FAILED' ? (
                      <span className="flex items-center text-rose-600 dark:text-rose-400 font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span>Delivery Failed</span>
                      </span>
                    ) : n.status === 'PENDING' ? (
                      <span className="flex items-center text-amber-600 dark:text-amber-400 font-semibold">
                        <Clock className="w-3.5 h-3.5 mr-1" />
                        <span>Queued</span>
                      </span>
                    ) : (
                      <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-semibold">
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
        <div className="p-3 bg-white/95 border-t border-slate-200/80 dark:bg-[#1E2430] dark:border-[#2E3646] text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-[#06B6D4] animate-pulse"></span>
            <span>Real-time Transit Alert Gateway</span>
          </span>
          <span className="font-mono font-bold text-[#4F46E5] dark:text-cyan-300">Sreenidhi Express</span>
        </div>
      </div>
    </div>
  );
};
