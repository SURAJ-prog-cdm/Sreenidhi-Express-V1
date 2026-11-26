import React, { useEffect, useRef, useState } from 'react';
import { Smartphone, CheckCircle2, ShieldCheck, X, AlertCircle, ArrowRight, RefreshCw, Bell } from 'lucide-react';
import { excelService } from '../../services/excelService';

interface PhoneOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userType: 'STUDENT' | 'PARENT';
  rollNumber: string;
  initialPhone?: string;
  onSuccess: (verifiedPhone: string) => void;
}

export const PhoneOnboardingModal: React.FC<PhoneOnboardingModalProps> = ({
  isOpen,
  onClose,
  userType,
  rollNumber,
  initialPhone = '',
  onSuccess
}) => {
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.replace(/\D/g, '').slice(-10));
  const [step, setStep] = useState<'PHONE_INPUT' | 'OTP_INPUT' | 'VERIFIED'>('PHONE_INPUT');
  const [otp, setOtp] = useState('');
  const [simulatedOtp, setSimulatedOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setPhoneNumber(initialPhone.replace(/\D/g, '').slice(-10));
      setStep('PHONE_INPUT');
      setOtp('');
      setSimulatedOtp(null);
      setError(null);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, initialPhone]);

  if (!isOpen) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = phoneNumber.replace(/\D/g, '');
    if (clean.length !== 10) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    setLoading(true);
    try {
      const data = await excelService.requestOtp(clean);
      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to send verification code');
      }
      if (data.verified === true) {
        setStep('VERIFIED');
        onSuccess(clean);
        setTimeout(() => {
          onClose();
        }, 1800);
        return;
      }
      setSimulatedOtp(data.simulatedOtp || null);
      setStep('OTP_INPUT');
    } catch (err: any) {
      setError(err.message || 'Network error requesting OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!otp || otp.length !== 6) {
      setError('Please enter the 6-digit code shown on screen');
      return;
    }

    setLoading(true);
    try {
      const data = await excelService.verifyOtp(phoneNumber, otp, userType, rollNumber);
      if (!data || !data.success) {
        throw new Error(data?.error || 'Invalid OTP code');
      }

      setStep('VERIFIED');
      onSuccess(phoneNumber);
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-md animate-in fade-in duration-200">
      <div className="prismatic-card animate-panel-in relative w-full max-w-md rounded-3xl p-6 text-slate-900 dark:text-slate-100">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-indigo-50 dark:hover:text-white dark:hover:bg-[#2E3646] transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-5 pr-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center space-x-2 flex-wrap">
              <span>{userType === 'PARENT' ? 'Parent Mobile Alerts' : 'Student Mobile Alerts'}</span>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-[#4F46E5] border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-700/40">
                Official
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Get live bus tracking &amp; arrival alerts on mobile
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-700/40 dark:text-rose-200 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Phone Input */}
        {step === 'PHONE_INPUT' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                {userType === 'PARENT' ? "Parent's Mobile Number" : "Student's Mobile Number"}
              </label>
              <div className="flex rounded-2xl overflow-hidden border border-slate-200 focus-within:border-[#4F46E5] transition-colors bg-[#F7F9FF] dark:border-[#2E3646] dark:bg-[#141821]">
                <span className="inline-flex items-center px-3.5 bg-indigo-50/70 text-[#4F46E5] dark:bg-[#1E2430] dark:text-indigo-300 text-xs font-extrabold border-r border-slate-200 dark:border-[#2E3646]">
                  🇮🇳 +91
                </span>
                <input
                  type="tel"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3.5 py-2.5 bg-transparent text-slate-900 dark:text-white text-sm font-bold focus:outline-none placeholder-slate-400 font-mono"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#06B6D4] shrink-0" />
                <span>Used strictly for transit updates, arrival alerts &amp; emergency notices.</span>
              </p>
            </div>

            <div className="pt-2 flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="w-1/3 py-2.5 px-3 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 dark:border-[#2E3646] dark:hover:bg-[#2E3646] dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Later
              </button>
              <button
                type="submit"
                disabled={loading || phoneNumber.length !== 10}
                className="electric-cta w-2/3 py-2.5 px-4 rounded-xl disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center space-x-2 cursor-pointer"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Send Verification Code</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: OTP Verification */}
        {step === 'OTP_INPUT' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {simulatedOtp && (
              <div className="p-3.5 rounded-2xl bg-indigo-50/90 border border-indigo-200 text-indigo-950 dark:bg-indigo-950/40 dark:border-indigo-700/40 dark:text-indigo-200">
                <div className="flex items-center justify-between text-xs font-bold mb-1">
                  <span className="flex items-center space-x-1.5">
                    <Bell className="w-3.5 h-3.5 text-[#4F46E5] dark:text-cyan-300" />
                    <span>SMS Simulation Gateway</span>
                  </span>
                  <span className="text-[10px] text-[#4F46E5] bg-white px-2 py-0.5 rounded-full border border-indigo-200 dark:bg-indigo-900/60 dark:text-indigo-200">
                    Just now
                  </span>
                </div>
                <p className="text-xs font-mono">
                  [Sreenidhi Express] Verification code:{' '}
                  <strong className="text-white text-sm bg-[#4F46E5] px-2 py-0.5 rounded-lg">
                    {simulatedOtp}
                  </strong>
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Enter 6-Digit Verification Code
                </label>
                <button
                  type="button"
                  onClick={() => setStep('PHONE_INPUT')}
                  className="text-[11px] font-bold text-[#4F46E5] hover:underline dark:text-cyan-300 cursor-pointer"
                >
                  Change (+91 {phoneNumber})
                </button>
              </div>
              <input
                type="text"
                maxLength={6}
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-2.5 bg-[#F7F9FF] border border-slate-200 focus:border-[#4F46E5] text-center tracking-widest text-lg font-mono font-bold text-slate-900 dark:bg-[#141821] dark:border-[#2E3646] dark:text-white rounded-2xl focus:outline-none"
                autoFocus
              />
            </div>

            <div className="pt-2 flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setStep('PHONE_INPUT')}
                className="w-1/3 py-2.5 px-3 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 dark:border-[#2E3646] dark:hover:bg-[#2E3646] dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="electric-cta w-2/3 py-2.5 px-4 rounded-xl disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center space-x-2 cursor-pointer"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Verify &amp; Activate Alerts</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Verified Success */}
        {step === 'VERIFIED' && (
          <div className="py-6 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 dark:bg-emerald-950/60 dark:border-emerald-700 dark:text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-base font-extrabold text-slate-900 dark:text-white">Mobile Alerts Activated!</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
              +91 {phoneNumber} is now registered for live bus departure, 5m pickup alerts, and campus arrival updates.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
