import React, { useState } from 'react';

interface SreenidhiLogoProps {
  compact?: boolean;
  className?: string;
}

export const SreenidhiLogo: React.FC<SreenidhiLogoProps> = ({ compact = false, className = '' }) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <div className="relative">
        <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-[#e53c2e]/50 via-indigo-500/40 to-cyan-400/50 blur-[3px]" />
        {!imgFailed ? (
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-white/40">
            <img
              src="/sreenidhi_express_logo.jpg"
              alt="Sreenidhi Express"
              className="h-8 w-8 rounded-lg object-cover"
              onError={() => setImgFailed(true)}
            />
          </div>
        ) : (
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#e53c2e] to-indigo-600 text-xs font-extrabold text-white shadow-sm">
            SUH
          </div>
        )}
      </div>

      {!compact && (
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold tracking-tight text-slate-900 dark:text-white sm:text-[15px]">
              Sreenidhi{' '}
              <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                Express
              </span>
            </span>
            <span className="hidden rounded-md border border-[#e53c2e]/30 bg-[#e53c2e]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#e53c2e] sm:inline-block">
              SUH
            </span>
          </div>
          <p className="text-[10px] font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Yamnampet • Ghatkesar Smart Transit HUD
          </p>
        </div>
      )}
    </div>
  );
};
