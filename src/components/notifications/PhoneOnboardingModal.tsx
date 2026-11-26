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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#181C24] border border-[#262C36] rounded-2xl p-6 shadow-2xl text-[#E5E8EC]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#222834] transition-colors"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-5">
          <div className="w-12 h-12 rounded-xl bg-[#0D4B42]/40 border border-[#10B981]/40 flex items-center justify-center text-[#10B981]">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <span>{userType === 'PARENT' ? 'Parent Mobile Alerts' : 'Student Mobile Alerts'}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Official
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Get live bus tracking & arrival SMS like Swiggy & Uber
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-500/40 text-red-200 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Phone Input */}
        {step === 'PHONE_INPUT' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {userType === 'PARENT' ? "Parent's Mobile Number" : "Student's Mobile Number"}
              </label>
              <div className="flex rounded-xl overflow-hidden border border-[#2A313D] focus-within:border-emerald-500 transition-colors bg-[#11141A]">
                <span className="inline-flex items-center px-3.5 bg-[#1B202A] text-slate-300 text-xs font-semibold border-r border-[#2A313D]">
                  🇮🇳 +91
                </span>
                <input
                  type="tel"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3.5 py-2.5 bg-transparent text-white text-sm focus:outline-none placeholder-slate-500 font-mono"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Used strictly for transit updates, arrival alerts & emergency notices.</span>
              </p>
            </div>

            <div className="pt-2 flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="w-1/3 py-2.5 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
              >
                Later
              </button>
              <button
                type="submit"
                disabled={loading || phoneNumber.length !== 10}
                className="w-2/3 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/30 transition-all"
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
            {/* Simulated SMS banner (realistic e-commerce prompt) */}
            {simulatedOtp && (
              <div className="p-3.5 rounded-xl bg-[#0F2D27] border border-emerald-500/40 text-emerald-200">
                <div className="flex items-center justify-between text-xs font-semibold mb-1">
                  <span className="flex items-center space-x-1.5">
                    <Bell className="w-3.5 h-3.5 text-emerald-400" />
                    <span>SMS Simulation Gateway</span>
                  </span>
                  <span className="text-[10px] text-emerald-400/80 bg-emerald-900/60 px-1.5 py-0.5 rounded">Just now</span>
                </div>
                <p className="text-xs font-mono">
                  [Sreenidhi Express] Your transit alerts verification code is{' '}
                  <strong className="text-white text-sm bg-emerald-700/60 px-1.5 py-0.5 rounded border border-emerald-400">
                    {simulatedOtp}
                  </strong>
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Enter 6-Digit Verification Code
                </label>
                <button
                  type="button"
                  onClick={() => setStep('PHONE_INPUT')}
                  className="text-[11px] text-emerald-400 hover:underline"
                >
                  Change Number (+91 {phoneNumber})
                </button>
              </div>
              <input
                type="text"
                maxLength={6}
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-2.5 bg-[#11141A] border border-[#2A313D] focus:border-emerald-500 text-center tracking-widest text-lg font-mono text-white rounded-xl focus:outline-none"
                autoFocus
              />
            </div>

            <div className="pt-2 flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setStep('PHONE_INPUT')}
                className="w-1/3 py-2.5 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-2/3 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/30 transition-all"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Verify & Activate Alerts</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Verified Success */}
        {step === 'VERIFIED' && (
          <div className="py-6 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-white">Mobile Alerts Activated!</h4>
            <p className="text-xs text-slate-300 max-w-xs mx-auto">
              +91 {phoneNumber} is now registered for live bus departure, 5m pickup alerts, and campus arrival updates.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
