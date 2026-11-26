import React, { useState } from 'react';
import {
  X,
  Smartphone,
  Apple,
  Monitor,
  Share2,
  PlusSquare,
  CheckCircle2,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { SreenidhiLogo } from '../common/SreenidhiLogo';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({ isOpen, onClose }) => {
  const [activePlatform, setActivePlatform] = useState<'IOS' | 'ANDROID' | 'DESKTOP'>('ANDROID');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-md animate-fade-in">
      <div className="prismatic-card animate-panel-in relative w-full max-w-lg overflow-hidden rounded-3xl p-6 text-slate-900 dark:text-slate-100">
        {/* Glow Highlights */}
        <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-cyan-400/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="relative flex items-center gap-3.5 pb-5 border-b border-slate-200/75 dark:border-[#2E3646]">
          <SreenidhiLogo compact className="shrink-0" />
          <div className="min-w-0 flex-1 pr-8">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight truncate">
                Install Sreenidhi Express
              </h2>
              <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 border border-cyan-200 text-cyan-700 dark:bg-cyan-500/20 dark:border-cyan-500/30 dark:text-cyan-300">
                PWA / APP
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Add to your Home Screen for instant offline GPS tracking
            </p>
          </div>
        </div>

        {/* Platform Switcher Tabs */}
        <div className="prismatic-subcard flex items-center gap-1.5 my-5 p-1 rounded-2xl">
          <button
            onClick={() => setActivePlatform('ANDROID')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition cursor-pointer ${
              activePlatform === 'ANDROID'
                ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Android</span>
          </button>

          <button
            onClick={() => setActivePlatform('IOS')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition cursor-pointer ${
              activePlatform === 'IOS'
                ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Apple className="w-3.5 h-3.5" />
            <span>iOS Safari</span>
          </button>

          <button
            onClick={() => setActivePlatform('DESKTOP')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition cursor-pointer ${
              activePlatform === 'DESKTOP'
                ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Desktop</span>
          </button>
        </div>

        {/* Tab 1: Android Chrome */}
        {activePlatform === 'ANDROID' && (
          <div className="space-y-3 animate-fade-in text-xs">
            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300 font-bold font-mono text-xs">
                1
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Tap Browser Menu (⋮)</p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Open Chrome or Edge on your phone and tap the three-dots menu icon in the top right.
                </p>
              </div>
            </div>

            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300 font-bold font-mono text-xs">
                2
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Select &quot;Install App&quot; or &quot;Add to Home Screen&quot;</p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Look for <span className="text-[#4F46E5] dark:text-cyan-300 font-semibold">Install Sreenidhi Express</span> or <span className="text-[#4F46E5] dark:text-cyan-300 font-semibold">Add to Home screen</span>.
                </p>
              </div>
            </div>

            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300 font-bold font-mono text-xs">
                3
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Confirm Installation</p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Tap <span className="text-[#4F46E5] dark:text-cyan-300 font-semibold">Install</span>. The app icon will be added to your home screen with zero app store download needed.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: iOS Safari */}
        {activePlatform === 'IOS' && (
          <div className="space-y-3 animate-fade-in text-xs">
            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400 font-bold font-mono text-xs">
                1
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  <span>Tap the Share Button</span>
                  <Share2 className="w-3.5 h-3.5 text-[#06B6D4]" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  In Safari, tap the Share icon (square with arrow pointing up) in the bottom navigation bar.
                </p>
              </div>
            </div>

            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400 font-bold font-mono text-xs">
                2
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  <span>Scroll &amp; Select &quot;Add to Home Screen&quot;</span>
                  <PlusSquare className="w-3.5 h-3.5 text-[#06B6D4]" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Swipe down in the share sheet and tap <span className="text-[#4F46E5] dark:text-cyan-300 font-semibold">Add to Home Screen</span>.
                </p>
              </div>
            </div>

            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400 font-bold font-mono text-xs">
                3
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Tap &quot;Add&quot; in Top Right</p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  The Sreenidhi Express standalone web app will be pinned to your iPhone home screen.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Desktop */}
        {activePlatform === 'DESKTOP' && (
          <div className="space-y-3 animate-fade-in text-xs">
            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[#4F46E5] dark:bg-purple-500/20 dark:text-purple-300 font-bold font-mono text-xs">
                1
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Click the Address Bar Install Icon</p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  In Google Chrome or Microsoft Edge, look at the right end of the URL bar for the install computer badge.
                </p>
              </div>
            </div>

            <div className="prismatic-subcard flex items-start gap-3 p-3.5 rounded-2xl">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[#4F46E5] dark:bg-purple-500/20 dark:text-purple-300 font-bold font-mono text-xs">
                2
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Run as Standalone Window</p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Click <span className="text-[#4F46E5] dark:text-cyan-300 font-semibold">Install</span>. The app launches in its own dedicated, distraction-free window.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Feature Badges */}
        <div className="mt-5 pt-4 border-t border-slate-200/75 dark:border-[#2E3646] flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Zero App Store Download</span>
          </div>
          <div className="flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Works Offline (PWA)</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#4F46E5] dark:text-indigo-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Instant Updates</span>
          </div>
        </div>
      </div>
    </div>
  );
};
