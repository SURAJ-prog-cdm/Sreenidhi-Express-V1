import React, { useState, useEffect } from 'react';
import {
  LogOut,
  CreditCard,
  Phone,
  PhoneCall,
  Clock,
  ShieldCheck,
  CalendarX,
  Star,
  PackageSearch,
  AlertCircle,
  CheckCircle2,
  BellRing,
  Bell,
  KeyRound,
  ShieldAlert,
  Home,
  Map as MapIcon,
  Bus,
  MoreHorizontal,
} from 'lucide-react';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import { HybridTransitMap } from '../map/HybridTransitMap';
import { MetroSchematicMap } from '../map/MetroSchematicMap';
import { excelService } from '../../services/excelService';
import { calculateStopEtaSeconds, getGoogleMapsLiveEta } from '../../services/mapsService';
import { nativeDeviceService } from '../../services/nativeDeviceService';
import { PhoneOnboardingModal } from '../notifications/PhoneOnboardingModal';
import { LiveTransitTracker } from '../notifications/LiveTransitTracker';
import { MobileAlertCard } from '../notifications/MobileAlertCard';
import { SmsMessageDrawer } from '../notifications/SmsMessageDrawer';

function formatHms(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function formatEtaWindow(totalSec: number): string {
  if (totalSec <= 45) return 'Arriving Now';
  if (totalSec <= 180) return '1–3 min';
  const mins = Math.round(totalSec / 60);
  return `${Math.max(1, mins - 1)}–${mins + 2} min`;
}

function formatArrivalClockWindow(totalSec: number): string {
  const nowMs = Date.now();
  const start = new Date(nowMs + Math.max(0, totalSec - 60) * 1000);
  const end = new Date(nowMs + (totalSec + 120) * 1000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${fmt(start)} – ${fmt(end)}`;
}

const ENABLE_PARENT_PORTAL = import.meta.env.VITE_ENABLE_PARENT_PORTAL === 'true';

export const StudentPortal: React.FC = () => {
  const {
    buses,
    activeStudent,
    activeBus,
    currentUser,
    setCurrentUser,
    logoutUser,
    twoMinCountdownSec,
    arrivalStage,
    markStudentNotComing,
    pushToast,
    routeOptimizationPlan,
    setAbsenceTomorrow,
  } = useCommuteSimulation();

  const [mapMode, setMapMode] = useState<'INTERACTIVE' | 'SCHEMATIC'>('INTERACTIVE');
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyServiceType, setApplyServiceType] = useState('BUS_PASS_RENEWAL');
  const [applyReason, setApplyReason] = useState('Fee cleared; request pass activation');

  // Parent app link code
  const [parentLinkCode, setParentLinkCode] = useState<string | null>(null);
  const [isGeneratingParentCode, setIsGeneratingParentCode] = useState<boolean>(false);

  // Real-time ticking Hour:Minute:Second countdown calculated by learned traffic / GPS
  const [countdownSec, setCountdownSec] = useState<number>(872);
  const [learnedMedians, setLearnedMedians] = useState<Record<string, { medianSec: number; sampleCount: number }>>({});
  const [etaDetails, setEtaDetails] = useState<{
    distanceKm: number;
    distanceText: string;
    source: string;
    expectedClockTime: string;
  }>({
    distanceKm: 4.8,
    distanceText: '4.8 km',
    source: 'Live GPS + Road ETA',
    expectedClockTime: '08:14:32 AM',
  });

  // Digital Bus Pass & Grace Pass State
  const [passState, setPassState] = useState<{
    feeStatus: string;
    passStatus: string;
    isGraceActive: boolean;
    graceUntil: number;
    canTravel: boolean;
    offlineCached?: boolean;
  }>({
    feeStatus: 'PAID',
    passStatus: 'ACTIVE',
    isGraceActive: false,
    graceUntil: 0,
    canTravel: true,
    offlineCached: false,
  });
  const [isActivatingGrace, setIsActivatingGrace] = useState(false);

  // v20.1 BusTrack Portal Tab & Hybrid Self-Check-In State
  const [portalTab, setPortalTab] = useState<'HOME' | 'MAP' | 'PASS' | 'MORE'>('HOME');
  const [showAbsenceBar, setShowAbsenceBar] = useState(false);
  const [isSelfCheckingIn, setIsSelfCheckingIn] = useState(false);
  const [localSelfBoarded, setLocalSelfBoarded] = useState(false);

  // Absence State ("Not Travelling" + 1h Pre-Departure Cutoff)
  const [isAbsentTomorrow, setIsAbsentTomorrow] = useState(false);
  const [absenceDay, setAbsenceDay] = useState<'TODAY' | 'TOMORROW'>('TOMORROW');
  const [absenceLocked, setAbsenceLocked] = useState(false);
  const [isUpdatingAbsence, setIsUpdatingAbsence] = useState(false);

  // Two-Step SOS Confirmation State
  const [confirmSos, setConfirmSos] = useState(false);
  const [isSendingSos, setIsSendingSos] = useState(false);

  // Lost & Found Form State
  const [lostDescription, setLostDescription] = useState('');
  const [isSubmittingLost, setIsSubmittingLost] = useState(false);

  // Ride Rating & Feedback State
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // Mobile Phone & Notification States (E-Commerce Style Alerts)
  const [studentPhone, setStudentPhone] = useState<string>('');
  const [isPhoneVerified, setIsPhoneVerified] = useState<boolean>(false);
  const [isPhoneModalOpen, setIsPhoneModalOpen] = useState<boolean>(false);
  const [isSmsDrawerOpen, setIsSmsDrawerOpen] = useState<boolean>(false);
  const [busDelayMinutes, setBusDelayMinutes] = useState<number>(0);
  const [isTripActive, setIsTripActive] = useState<boolean>(true);

  // Forced Temporary Password Change Modal State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);
  const [currentPw, setCurrentPw] = useState<string>('');
  const [newPw, setNewPw] = useState<string>('');
  const [confirmPw, setConfirmPw] = useState<string>('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [isSubmittingPw, setIsSubmittingPw] = useState<boolean>(false);

  useEffect(() => {
    if (currentUser?.mustChangePassword || (activeStudent as any)?.mustChangePassword) {
      setIsPasswordModalOpen(true);
    }
  }, [currentUser?.mustChangePassword, (activeStudent as any)?.mustChangePassword]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (newPw.length < 10) {
      setPwError('New password must be at least 10 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }
    setIsSubmittingPw(true);
    try {
      const res = await excelService.changePassword(currentPw, newPw);
      if (res.success) {
        setIsPasswordModalOpen(false);
        if (res.token && currentUser) {
          setCurrentUser({ ...currentUser, token: res.token, mustChangePassword: false });
        } else if (currentUser) {
          currentUser.mustChangePassword = false;
        }
        if (activeStudent) (activeStudent as any).mustChangePassword = false;
        pushToast('success', 'Password Updated', 'Your temporary password has been permanently updated.');
      } else {
        setPwError(res.message || 'Current password incorrect.');
      }
    } finally {
      setIsSubmittingPw(false);
    }
  };

  // Load backend pass & absence states on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const p = await excelService.getPassStatus();
      if (mounted) setPassState(p);
      const abs = await excelService.getAbsenceTomorrow(activeStudent?.rollNumber);
      if (mounted) setIsAbsentTomorrow(abs.absentTomorrow);
    })();

    const roll = currentUser?.role === 'STUDENT' ? (currentUser.rollNumber || activeStudent?.rollNumber || '23SN1A0501') : (activeStudent?.rollNumber || '23SN1A0501');
    excelService.getContactInfo(roll)
      .then((data) => {
        if (mounted && data && data.studentPhone) {
          setStudentPhone(data.studentPhone);
          setIsPhoneVerified(Boolean(data.studentPhoneVerified));
        } else if (mounted) {
          const prompted = sessionStorage.getItem('student_phone_prompted');
          if (!prompted) {
            setIsPhoneModalOpen(true);
            sessionStorage.setItem('student_phone_prompted', '1');
          }
        }
      })
      .catch((err) => console.error('Failed to load contact info', err));

    excelService.getBusState(activeBus?.routeId || 'route-51')
      .then((data) => {
        if (mounted && data.success) {
          setIsTripActive(data.running ?? true);
          setBusDelayMinutes(data.delayMinutes || 0);
        }
      })
      .catch((err) => console.error('Failed to load bus state', err));

    return () => {
      mounted = false;
    };
  }, [activeStudent?.rollNumber, activeBus?.routeId]);

  // Fetch learned Hyderabad traffic segment medians (₹0 ML / Median model)
  useEffect(() => {
    let mounted = true;
    if (activeBus?.routeId) {
      excelService.fetchEtaModel(activeBus.routeId).then((res) => {
        if (mounted && res?.segments) {
          setLearnedMedians(res.segments);
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, [activeBus?.routeId]);

  // Calculate dynamic ETA whenever bus GPS, telemetry, or target changes
  useEffect(() => {
    let isMounted = true;
    const calculateEta = async () => {
      const studentStop =
        activeBus.stops.find((s) => s.id === (activeStudent?.pickupStopId || activeBus.stops[0]?.id)) ||
        activeBus.stops[0];
      if (!studentStop) return;

      const targetStopIndex = activeBus.stops.findIndex((s) => s.id === studentStop.id);
      const safeTargetIndex = targetStopIndex >= 0 ? targetStopIndex : 0;

      const res = await getGoogleMapsLiveEta(
        { lat: activeBus.currentLat, lng: activeBus.currentLng },
        { lat: studentStop.lat, lng: studentStop.lng },
        activeBus.speedKmh,
        activeBus.trafficDelayMinutes,
      );

      if (!isMounted) return;

      let finalSeconds = 0;
      let finalSource = 'Live GPS + Road ETA';
      const hasLearned = Object.keys(learnedMedians).length > 0;

      if (res.source === 'GOOGLE_MAPS_DIRECTIONS') {
        finalSeconds = res.seconds;
        finalSource = 'Google Maps Directions';
      } else if (hasLearned) {
        finalSeconds = calculateStopEtaSeconds(
          activeBus.currentLat,
          activeBus.currentLng,
          activeBus.stops,
          activeBus.currentStopIndex,
          safeTargetIndex,
          activeBus.speedKmh,
          activeBus.trafficDelayMinutes,
          learnedMedians,
        );
        finalSource = 'Learned Traffic ETA';
      } else {
        finalSeconds = calculateStopEtaSeconds(
          activeBus.currentLat,
          activeBus.currentLng,
          activeBus.stops,
          activeBus.currentStopIndex,
          safeTargetIndex,
          activeBus.speedKmh,
          activeBus.trafficDelayMinutes,
        );
        finalSource = 'Live GPS + Road ETA';
      }

      if (finalSeconds > 0) {
        setCountdownSec(finalSeconds);
        const arrivalDate = new Date(Date.now() + finalSeconds * 1000);
        const timeStr = arrivalDate.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setEtaDetails({
          distanceKm: res.distanceKm,
          distanceText: res.distanceText,
          source: finalSource,
          expectedClockTime: timeStr,
        });
      }
    };

    void calculateEta();
    return () => {
      isMounted = false;
    };
  }, [
    activeBus.currentLat,
    activeBus.currentLng,
    activeBus.speedKmh,
    activeBus.trafficDelayMinutes,
    activeBus.currentStopIndex,
    activeBus.stops,
    activeStudent?.pickupStopId,
    learnedMedians,
  ]);

  // Active 1-second countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const studentName = currentUser?.role === 'STUDENT' ? currentUser.name : (activeStudent?.name || 'Aarav Reddy');
  const studentRoll = currentUser?.role === 'STUDENT' ? (currentUser.rollNumber || activeStudent?.rollNumber || '23SN1A0501') : (activeStudent?.rollNumber || '23SN1A0501');
  const isFaculty = activeStudent?.riderType === 'FACULTY' || /^(FAC-|4000|6000)/i.test(studentRoll);
  const routeNumber = activeBus?.routeNumber || 'Route 14';
  const assignedStopName =
    activeBus.stops.find((s) => s.id === (activeStudent?.pickupStopId || activeBus.stops[0]?.id))?.name ||
    activeBus.stops[0]?.name ||
    'Campus Terminal';

  // Active countdown display (retained for secondary 2-min doorstep alert if needed)
  const displayCountdownWindow =
    arrivalStage === 'ARRIVED_2_MIN_TIMER' && twoMinCountdownSec > 0
      ? 'Arriving Now'
      : formatEtaWindow(countdownSec);
  void displayCountdownWindow;

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await excelService.submitApplication({
        requestType: applyServiceType,
        title: 'Student Transit Hub Request',
        description: applyReason,
      });
      if (res && res.success) {
        pushToast('success', 'Application Submitted', 'Your request has reached the Transport Office for scrutiny.');
      } else {
        pushToast('danger', 'Submission Failed', 'Could not submit application.');
      }
    } catch (err: any) {
      pushToast('danger', 'Submission Failed', err?.message || 'Could not submit application.');
    }
    setShowApplyModal(false);
  };

  const handleGenerateParentCode = async () => {
    setIsGeneratingParentCode(true);
    try {
      const code = await excelService.createParentAccessCode();
      if (code) {
        setParentLinkCode(code);
        pushToast('success', 'Parent Access Code Generated', `Share code ${code} with your parents.`);
      } else {
        pushToast('danger', 'Generation Failed', 'Could not generate parent access code.');
      }
    } finally {
      setIsGeneratingParentCode(false);
    }
  };

  const handleActivateGrace = async () => {
    setIsActivatingGrace(true);
    const res = await excelService.activateGracePass();
    setIsActivatingGrace(false);
    if (res.success) {
      setPassState((prev) => ({
        ...prev,
        isGraceActive: true,
        canTravel: true,
        graceUntil: Date.now() + 24 * 3600 * 1000,
      }));
      pushToast('success', '1-Day Grace Pass Activated', res.validUntilText ? `Valid until ${res.validUntilText}` : 'Active for 24 hours');
    } else {
      pushToast('danger', 'Grace Pass Failed', res.message || 'Could not activate grace pass.');
    }
  };

  const isOnBoardCleared =
    localSelfBoarded ||
    activeStudent?.boardingStatus === 'ON_BOARD' ||
    arrivalStage === 'CLEARED_ON_BOARD' ||
    arrivalStage === 'CLEARED_BOARDED';

  const handleSelfCheckIn = async (method: 'STUDENT_SELF_TAP' | 'BLE_PROXIMITY' = 'STUDENT_SELF_TAP') => {
    if (isSelfCheckingIn || isOnBoardCleared) return;
    setIsSelfCheckingIn(true);
    try {
      const res = await excelService.selfCheckInBoarding(method);
      if (res.success) {
        setLocalSelfBoarded(true);
        void nativeDeviceService.triggerHaptic('medium');
        pushToast(
          'success',
          res.alreadyBoarded ? 'Already Checked In' : 'On Board ✓',
          method === 'BLE_PROXIMITY'
            ? 'Proximity beacon detected — you are checked in on board.'
            : 'Driver headcount and transit milestones updated.'
        );
      } else {
        pushToast('warning', 'Check-In Unavailable', res.message || 'Wait until the driver starts the trip.');
      }
    } finally {
      setIsSelfCheckingIn(false);
    }
  };

  useEffect(() => {
    if (isOnBoardCleared || !isTripActive || !activeBus?.routeId) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void nativeDeviceService
      .tryProximityBleCheckIn(activeBus.routeId, (method) => {
        if (!cancelled) void handleSelfCheckIn(method);
      })
      .then((fn) => {
        if (cancelled) fn();
        else cleanup = fn;
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [isOnBoardCleared, isTripActive, activeBus?.routeId]);

  useEffect(() => {
    let active = true;
    void excelService.getAbsenceTomorrow(studentRoll, absenceDay).then((res) => {
      if (active) {
        setIsAbsentTomorrow(Boolean(res.absentTomorrow));
        setAbsenceLocked(Boolean(res.locked));
      }
    });
    return () => {
      active = false;
    };
  }, [studentRoll, absenceDay]);

  const handleToggleAbsence = async () => {
    setIsUpdatingAbsence(true);
    const nextState = !isAbsentTomorrow;
    const res = await setAbsenceTomorrow(studentRoll, nextState, absenceDay);
    setIsUpdatingAbsence(false);
    if (res.locked) setAbsenceLocked(true);
    if (res.success) {
      setIsAbsentTomorrow(nextState);
    } else if (res.error) {
      pushToast('warning', 'Opt-Out Locked', res.error);
    }
  };

  const handleConfirmSos = async () => {
    setIsSendingSos(true);
    const ok = await excelService.reportIncident(
      'SOS',
      `Student SOS triggered by ${studentName} (${studentRoll}) at assigned stop ${assignedStopName}`,
      activeBus.routeId
    );
    setIsSendingSos(false);
    setConfirmSos(false);
    if (ok) {
      pushToast('danger', 'SOS Dispatched', 'Emergency notification dispatched to Transport Office and linked Parent.');
    } else {
      pushToast('warning', 'SOS Recorded', 'Alert recorded on campus safety channel.');
    }
  };

  const handleSubmitLost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lostDescription.trim()) return;
    setIsSubmittingLost(true);
    const ok = await excelService.reportLostItem(lostDescription.trim(), `${studentName} (${studentRoll})`);
    setIsSubmittingLost(false);
    if (ok) {
      setLostDescription('');
      pushToast('success', 'Reported to Transport Office', 'Staff will check the vehicle and notify you.');
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await excelService.submitFeedback(feedbackRating, feedbackMsg, activeBus.routeId);
    if (ok) {
      setFeedbackSubmitted(true);
      pushToast('success', 'Feedback Received', 'Thank you for rating your daily campus ride!');
    }
  };

  const firstName = (studentName || 'Commuter').trim().split(/\s+/)[0] || 'Commuter';
  const routeNum = routeNumber.replace(/^Route\s*/i, '').trim() || routeNumber;
  const heroEtaLabel =
    arrivalStage === 'ARRIVED_2_MIN_TIMER' && twoMinCountdownSec > 0
      ? 'Arriving Now'
      : formatEtaWindow(countdownSec);
  const clockWindowLabel = formatArrivalClockWindow(countdownSec);
  const recentUpdateText = (() => {
    if (arrivalStage === 'ARRIVED_2_MIN_TIMER' && twoMinCountdownSec > 0) {
      return `Bus arrived at ${assignedStopName} — 2-minute boarding timer active.`;
    }
    if (activeBus.status === 'BREAKDOWN_RESCUE_ACTIVE') {
      return 'Breakdown rescue dispatch active — standby shuttle en route.';
    }
    if (busDelayMinutes > 0) {
      return `+${busDelayMinutes} min traffic advisory reported on ${routeNumber} corridor.`;
    }
    if (routeOptimizationPlan?.skippedClusterIds?.length) {
      return `${routeOptimizationPlan.skippedClusterIds.length} empty area cluster(s) bypassed for highway express timing.`;
    }
    if (!isTripActive) {
      return `Scheduled dispatch from terminus — next pickup at ${assignedStopName}.`;
    }
    return `Bus #${routeNum} live via ${etaDetails.source} (${etaDetails.distanceText} away).`;
  })();

  const studentStopObj = activeBus?.stops.find((s) => s.id === activeStudent?.pickupStopId) || activeBus?.stops[0];
  const studentClusterId = activeStudent?.areaClusterId || studentStopObj?.areaClusterId || '';
  const isClusterBypassed = Boolean(
    routeOptimizationPlan?.skippedClusterIds?.includes(studentClusterId)
  );
  const isDownstreamBypass = Boolean(
    routeOptimizationPlan?.skippedClusterIds?.length &&
      !isClusterBypassed &&
      activeBus?.stops.some(
        (s) =>
          s.sequence < (studentStopObj?.sequence || 99) &&
          routeOptimizationPlan.skippedClusterIds.includes(s.areaClusterId)
      )
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-24 antialiased">
      {/* Compact Greeting Header (Always Visible at Top) */}
      <div className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-white p-3.5 sm:p-4 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <img
            src="/sreenidhi_express_logo.jpg"
            alt="Sreenidhi Express Logo"
            className="h-10 w-10 shrink-0 rounded-full object-cover shadow-xs ring-2 ring-[#4F46E5]/20 dark:ring-indigo-400/30"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                Welcome Back, {firstName}
              </h1>
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-extrabold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300">
                Route {routeNum} • SUH Campus
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">
              {isFaculty ? 'Employee ID' : 'Roll No'}: {studentRoll}
            </p>
          </div>
        </div>

        {/* Circular Notification Bell & Logout Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsSmsDrawerOpen(true)}
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-slate-50 text-slate-600 transition hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-300 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300 cursor-pointer"
            title="Live Transit SMS & App Messages"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          </button>
          <button
            type="button"
            onClick={logoutUser}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-slate-50 text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 2-Minute Stop Arrival Countdown & Not Coming Opt-Out Action */}
      {arrivalStage === 'ARRIVED_2_MIN_TIMER' && twoMinCountdownSec > 0 && (
        <div className="rounded-3xl border border-amber-400/50 bg-amber-50 p-3.5 shadow-sm dark:bg-amber-950/40 dark:border-amber-700/60 animate-pulse">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="text-xs font-black uppercase text-amber-800 dark:text-amber-200">
                  Bus at {assignedStopName} (2-Min Timer)
                </p>
                <p className="font-mono text-base font-black text-amber-900 dark:text-white">
                  {formatHms(twoMinCountdownSec)} remaining
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await markStudentNotComing(activeStudent?.id || 'stu-01', 'Skipped by student at stop approaching');
                pushToast('info', 'Stop Skipped', 'Driver notified that you are not boarding this trip.');
              }}
              className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-rose-700 active:scale-95 cursor-pointer shrink-0"
            >
              Not Coming
            </button>
          </div>
        </div>
      )}

      {/* Proactive Proximity Heads-Up Departure Banner */}
      {countdownSec > 0 && countdownSec <= 120 && (
        <div className="flex items-center gap-2.5 rounded-3xl border border-emerald-500/30 bg-emerald-50/90 p-3 text-xs font-bold text-emerald-800 shadow-sm dark:bg-emerald-950/50 dark:text-emerald-200 animate-pulse">
          <BellRing className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>Bus arriving at {assignedStopName} now! Head to the boarding point.</span>
        </div>
      )}
      {countdownSec > 120 && countdownSec <= 600 && (
        <div className="flex items-center gap-2.5 rounded-3xl border border-amber-500/30 bg-amber-50/90 p-3 text-xs font-bold text-amber-800 shadow-sm dark:bg-amber-950/50 dark:text-amber-200">
          <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>10-Minute Heads-Up: Bus is ~{Math.round(countdownSec / 60)} mins away. Leave for your stop!</span>
        </div>
      )}

      {portalTab === 'HOME' && (
        <div className="space-y-4">
          {/* Primary Indigo Hero Card */}
          <div className="rounded-3xl bg-gradient-to-br from-[#4F46E5] to-[#5B52F0] p-5 text-white shadow-lg shadow-indigo-500/20">
            {/* Top row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15">
                  <Bus className="h-4 w-4 text-white" />
                </span>
                <span className="text-sm font-extrabold tracking-tight">Bus #{routeNum}</span>
              </div>
              {busDelayMinutes > 0 ? (
                <span className="inline-flex items-center rounded-full bg-amber-400/25 px-3 py-1 text-[11px] font-extrabold text-amber-100 ring-1 ring-amber-300/40">
                  +{busDelayMinutes}m Delay
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/25 px-3 py-1 text-[11px] font-extrabold text-emerald-100 ring-1 ring-emerald-300/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  On Time
                </span>
              )}
            </div>

            {/* Split Metric Row */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white/10 p-3.5 backdrop-blur-xs">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-indigo-100/80">Estimated Arrival:</p>
                <p className="mt-0.5 text-xl sm:text-2xl font-black tracking-tight text-white">
                  {heroEtaLabel}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-indigo-100/85 truncate">
                  ±2 min buffer • {clockWindowLabel}
                </p>
              </div>
              <div className="min-w-0 border-l border-white/15 pl-3">
                <p className="text-[11px] font-semibold text-indigo-100/80">Next Stop:</p>
                <p className="mt-0.5 text-base sm:text-lg font-extrabold leading-snug text-white line-clamp-2">
                  {assignedStopName}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-indigo-100/85 truncate">
                  {etaDetails.distanceText} • {etaDetails.source}
                </p>
              </div>
            </div>

            {/* Bottom 2-Button Action Row */}
            <div className="mt-4 flex items-center gap-2.5">
              {isOnBoardCleared ? (
                <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-400/25 px-4 py-2.5 text-xs font-extrabold text-white ring-1 ring-emerald-200/50">
                  On Board ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSelfCheckIn('STUDENT_SELF_TAP')}
                  disabled={isSelfCheckingIn || !isTripActive}
                  className="flex-1 rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-[#4F46E5] shadow-sm transition hover:bg-indigo-50 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {isSelfCheckingIn ? 'Checking In...' : isTripActive ? "I'm On Board" : 'Wait for Trip Start'}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowAbsenceBar(true);
                  if (!absenceLocked) {
                    void handleToggleAbsence();
                  }
                }}
                disabled={isUpdatingAbsence}
                className={`rounded-xl px-3.5 py-2.5 text-xs font-bold transition active:scale-[0.98] disabled:opacity-60 cursor-pointer ${
                  isAbsentTomorrow
                    ? 'bg-amber-400/30 text-white ring-1 ring-amber-200/70 hover:bg-amber-400/40'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isAbsentTomorrow ? 'Absent ✓' : 'Not Traveling'}
              </button>
            </div>
          </div>

          {/* Inline Absence Day Selector & 1h Cutoff Caption (Shown When Toggled / Active / Expandable) */}
          {(showAbsenceBar || isAbsentTomorrow) ? (
            <div className="rounded-3xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`rounded-xl p-2 ${
                      isAbsentTomorrow
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'bg-indigo-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300'
                    }`}
                  >
                    <CalendarX className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                        Opt-Out ({absenceDay === 'TODAY' ? 'Today' : 'Tomorrow'})
                      </span>
                      <div className="inline-flex rounded-lg border border-slate-200/80 bg-[#F5F7FB] p-0.5 text-[10px] font-bold dark:border-[#2E3646] dark:bg-[#141821]">
                        <button
                          type="button"
                          onClick={() => setAbsenceDay('TODAY')}
                          className={`rounded-md px-2 py-0.5 cursor-pointer transition ${
                            absenceDay === 'TODAY'
                              ? 'bg-[#4F46E5] text-white'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          onClick={() => setAbsenceDay('TOMORROW')}
                          className={`rounded-md px-2 py-0.5 cursor-pointer transition ${
                            absenceDay === 'TOMORROW'
                              ? 'bg-[#4F46E5] text-white'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          Tomorrow
                        </button>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {absenceLocked
                        ? 'Locked within 1h of departure — contact Transport Office for urgent updates'
                        : 'Cutoff: 1 hour before bus departure'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleAbsence}
                    disabled={isUpdatingAbsence || absenceLocked}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                      isAbsentTomorrow ? 'bg-[#4F46E5]' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                    role="switch"
                    aria-checked={isAbsentTomorrow}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
                        isAbsentTomorrow ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAbsenceBar(false)}
                    className="rounded-lg px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Cutoff: 1 hour before bus departure</span>
              <button
                type="button"
                onClick={() => setShowAbsenceBar(true)}
                className="font-bold text-[#4F46E5] hover:underline dark:text-indigo-400 cursor-pointer"
              >
                Today / Tomorrow options
              </button>
            </div>
          )}

          {/* Area Cluster Bypass Notice */}
          {isClusterBypassed && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="font-bold">⚠️ Area Cluster Bypassed:</span> 100% of riders in your area marked absent. Bus uses the highway express route.
            </div>
          )}
          {isDownstreamBypass && (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-[11px] text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
              <span className="font-bold">⚡ Earlier Arrival Notice:</span> Upstream area cluster skipped. Bus may arrive 5–10 minutes earlier.
            </div>
          )}

          {/* Rounded Live Map Preview Card */}
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div className="h-48 sm:h-56 w-full bg-slate-100 dark:bg-[#141821]">
              <HybridTransitMap
                buses={buses}
                focusedBus={activeBus}
                highlightStopId={activeStudent?.pickupStopId || activeBus.stops[0]?.id}
                heightClass="h-48 sm:h-56 w-full"
              />
            </div>
            <button
              type="button"
              onClick={() => setPortalTab('MAP')}
              className="flex w-full items-center justify-center gap-1.5 bg-[#4F46E5] py-2.5 text-xs font-bold text-white transition hover:bg-[#4338CA] cursor-pointer"
            >
              <span>View Full Map / Metro View →</span>
            </button>
          </div>

          {/* Compact Recent Updates + Driver Strip */}
          <div className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Recent Updates:
              </p>
              <p className="mt-0.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
                {recentUpdateText}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Driver: <b className="text-slate-700 dark:text-slate-200">{activeBus.driverName || 'Assigned Driver'}</b> ({activeBus.driverPhone || '+91 77999 56801'})
              </p>
            </div>
            <a
              href={`tel:${activeBus.driverPhone ? activeBus.driverPhone.replace(/\s+/g, '') : '+917799956801'}`}
              title={`Call ${activeBus.driverName || 'Driver'}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#4F46E5] text-white shadow-sm transition hover:bg-[#4338CA] active:scale-95"
            >
              <Phone className="h-4 w-4" />
            </a>
          </div>
        </div>
      )}

      {portalTab === 'MAP' && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div className="flex items-center justify-between border-b border-slate-100 p-3.5 dark:border-[#2E3646]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#4F46E5] animate-pulse" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Corridor Tracking • {routeNumber}
                </span>
              </div>

              <div className="flex items-center gap-1 rounded-xl bg-[#F5F7FB] p-1 dark:bg-[#141821]">
                <button
                  type="button"
                  onClick={() => setMapMode('INTERACTIVE')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    mapMode === 'INTERACTIVE'
                      ? 'bg-[#4F46E5] text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  Interactive Map
                </button>
                <button
                  type="button"
                  onClick={() => setMapMode('SCHEMATIC')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    mapMode === 'SCHEMATIC'
                      ? 'bg-[#4F46E5] text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  Metro Line
                </button>
              </div>
            </div>

            <div className="h-80 sm:h-96 w-full bg-slate-100 dark:bg-[#141821]">
              {mapMode === 'INTERACTIVE' ? (
                <HybridTransitMap
                  buses={buses}
                  focusedBus={activeBus}
                  highlightStopId={activeStudent?.pickupStopId || activeBus.stops[0]?.id}
                  heightClass="h-80 sm:h-96 w-full"
                />
              ) : (
                <MetroSchematicMap
                  activeBus={activeBus}
                  highlightStopId={activeStudent?.pickupStopId || activeBus.stops[0]?.id}
                />
              )}
            </div>
          </div>

          <LiveTransitTracker
            routeId={activeBus.routeId}
            routeName={activeBus.routeName}
            pickupStop={assignedStopName}
            isTripStarted={isTripActive}
            delayMinutes={busDelayMinutes}
            formattedCountdown={heroEtaLabel}
            studentName={studentName}
            rollNumber={studentRoll}
          />
        </div>
      )}

      {portalTab === 'PASS' && (
        <div className="space-y-4">
          {/* Digital Campus Bus Pass Card */}
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div
              className={`p-5 ${
                passState.canTravel
                  ? 'bg-gradient-to-br from-[#4F46E5]/10 via-indigo-50/40 to-white dark:from-[#4F46E5]/20 dark:via-[#1E2430] dark:to-[#1E2430]'
                  : 'bg-rose-50 dark:bg-rose-950/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className={`h-5 w-5 ${
                      passState.canTravel ? 'text-[#4F46E5] dark:text-indigo-400' : 'text-rose-500'
                    }`}
                  />
                  <span className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                    Digital Campus Bus Pass
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                    passState.offlineCached
                      ? 'border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-200'
                      : passState.feeStatus === 'UNAVAILABLE'
                      ? 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                      : passState.isGraceActive
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                      : passState.canTravel
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
                  }`}
                >
                  {passState.offlineCached
                    ? 'OFFLINE CACHED PASS'
                    : passState.feeStatus === 'UNAVAILABLE'
                    ? 'STATUS UNAVAILABLE'
                    : passState.isGraceActive
                    ? '1-DAY GRACE PASS'
                    : passState.canTravel
                    ? 'FEE PAID · ACTIVE'
                    : 'PASS LOCKED · FEE DUE'}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3.5 dark:border-[#2E3646]">
                <div>
                  <p className="text-sm font-extrabold text-slate-900 dark:text-white">
                    {studentName} • <span className="font-mono">{studentRoll}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {routeNumber} • {assignedStopName}
                  </p>
                  {passState.isGraceActive && passState.graceUntil > 0 && (
                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1">
                      Grace pass valid until: {new Date(passState.graceUntil).toLocaleString('en-IN', { hour12: true })}
                    </p>
                  )}
                </div>

                {!passState.canTravel && !passState.isGraceActive && passState.feeStatus !== 'UNAVAILABLE' && (
                  <button
                    type="button"
                    onClick={handleActivateGrace}
                    disabled={isActivatingGrace}
                    className="rounded-xl bg-[#4F46E5] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {isActivatingGrace ? 'Activating...' : 'Activate 1-Day Grace Pass'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Transport Assistance & Helpline (+91 77999 56801) */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-[#4F46E5] dark:text-indigo-400" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Transport Assistance &amp; Help Desk
              </h2>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-[#F5F7FB] p-3.5 dark:border-[#2E3646] dark:bg-[#141821]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Assigned Bus Driver ({routeNumber})
                  </p>
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white">
                    {activeBus.driverName || 'Assigned Driver'}
                  </p>
                  <p className="font-mono text-xs font-bold text-[#4F46E5] dark:text-indigo-400">
                    {activeBus.driverPhone || '+91 77999 56801'}
                  </p>
                </div>

                <a
                  href={`tel:${activeBus.driverPhone ? activeBus.driverPhone.replace(/\s+/g, '') : '+917799956801'}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#4F46E5] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] active:scale-95"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call Driver</span>
                </a>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-[#F5F7FB] p-3.5 dark:border-[#2E3646] dark:bg-[#141821]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Sreenidhi Transport Helpline
                  </p>
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white">
                    Campus Transport Desk (SNIST)
                  </p>
                  <p className="font-mono text-xs font-bold text-[#4F46E5] dark:text-indigo-400">
                    +91 77999 56801 / +91 77999 56802
                  </p>
                </div>

                <a
                  href="tel:+917799956801"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/20 active:scale-95"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call Helpline</span>
                </a>
              </div>

              <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-[11px] text-slate-500 dark:border-[#2E3646] dark:text-slate-400">
                <p>
                  <b>Campus EPABX:</b> +91 8415-395222 / 395444 • <b>General:</b> +91 9948119481
                </p>
                <p className="mt-0.5">
                  <b>Campus:</b> Yamnampet, Ghatkesar, Hyderabad - 501301 (Telangana)
                </p>
              </div>
            </div>
          </div>

          {/* Emergency SOS Flow (2-Step Confirmation) */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            {confirmSos ? (
              <div className="space-y-2.5">
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />
                  Send an emergency SOS to the transport office?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmSos}
                    disabled={isSendingSos}
                    className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-rose-700 active:scale-95 cursor-pointer"
                  >
                    {isSendingSos ? 'Dispatching SOS...' : 'Yes, Send SOS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSos(false)}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 dark:border-[#2E3646] dark:text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    Emergency Assistance &amp; Safety SOS
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Instant distress alert dispatched with live coordinates
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmSos(true)}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-rose-700 active:scale-95 cursor-pointer"
                >
                  SOS
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Secondary Utilities on MORE Tab */}
      {portalTab === 'MORE' && (
        <div className="space-y-4">
          {ENABLE_PARENT_PORTAL && !isFaculty && (
            <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-2xl bg-indigo-50 p-2.5 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Parent Portal Access Code
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Generate a 30-day secure code to link your parent&apos;s phone
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateParentCode}
                  disabled={isGeneratingParentCode}
                  className="rounded-xl bg-[#4F46E5] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingParentCode ? 'Generating...' : parentLinkCode ? 'Refresh Code' : 'Generate Code'}
                </button>
              </div>

              {parentLinkCode && (
                <div className="mt-3 rounded-2xl bg-[#F5F7FB] p-3 border border-slate-200 dark:bg-[#141821] dark:border-[#2E3646] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                      Share with Parent:
                    </span>
                    <p className="font-mono text-sm font-black text-[#4F46E5] dark:text-indigo-400 tracking-widest">
                      {parentLinkCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(parentLinkCode);
                      pushToast('success', 'Code Copied', 'Parent access code copied to clipboard.');
                    }}
                    className="rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}

          <MobileAlertCard
            userType={isFaculty ? 'FACULTY' : 'STUDENT'}
            rollNumber={studentRoll}
            phoneNumber={studentPhone}
            isVerified={isPhoneVerified}
            onOpenPhoneModal={() => setIsPhoneModalOpen(true)}
            onNotificationSent={() => setIsSmsDrawerOpen(true)}
          />

          {/* Lost & Found Item Form */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-5 w-5 text-[#4F46E5] dark:text-indigo-400" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Lost Something on the Bus?
              </h2>
            </div>
            <form onSubmit={handleSubmitLost} className="mt-3 space-y-2.5">
              <textarea
                value={lostDescription}
                onChange={(e) => setLostDescription(e.target.value)}
                rows={2}
                placeholder="Describe the item (e.g. Blue water bottle, left on seat 12 on Route 14)"
                className="w-full rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-3 text-xs text-slate-900 outline-none focus:border-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                maxLength={280}
                required
              />
              <button
                type="submit"
                disabled={isSubmittingLost || !lostDescription.trim()}
                className="rounded-xl bg-[#4F46E5] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] disabled:opacity-50 cursor-pointer"
              >
                {isSubmittingLost ? 'Reporting...' : 'Report to Transport Office'}
              </button>
            </form>
          </div>

          {/* Ride Quality Feedback & 1-5 Star Rating */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Rate Today&apos;s Ride Experience
                </h2>
              </div>
              {feedbackSubmitted && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Feedback Sent
                </span>
              )}
            </div>

            {!feedbackSubmitted ? (
              <form onSubmit={handleSubmitFeedback} className="mt-3 space-y-2.5">
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setFeedbackRating(star)}
                      className="p-1 cursor-pointer transition hover:scale-110"
                    >
                      <Star
                        className={`h-6 w-6 ${
                          star <= feedbackRating
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-xs font-bold text-slate-900 dark:text-white">
                    {feedbackRating} / 5 Stars
                  </span>
                </div>

                <textarea
                  value={feedbackMsg}
                  onChange={(e) => setFeedbackMsg(e.target.value)}
                  rows={2}
                  placeholder="How was the driver, bus cleanliness, or highway ride punctuality?"
                  className="w-full rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-3 text-xs text-slate-900 outline-none focus:border-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  maxLength={280}
                />

                <button
                  type="submit"
                  className="rounded-xl bg-[#4F46E5] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] cursor-pointer"
                >
                  Submit Ride Feedback
                </button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Your rating helps the transport department maintain top safety and punctuality standards.
              </p>
            )}
          </div>

          {/* Quick Action Dock for Student Requests */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowApplyModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-3xl border border-slate-200/80 bg-white p-3.5 text-xs font-bold text-slate-900 shadow-sm transition hover:bg-indigo-50/50 dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white dark:hover:bg-[#262E3D] cursor-pointer"
            >
              <CreditCard className="h-4 w-4 text-[#4F46E5] dark:text-indigo-400" />
              <span>Transit Services Desk</span>
            </button>
          </div>
        </div>
      )}

      {/* Sleek Docked 4-Tab Pill Bottom Bar */}
      <nav
        aria-label="Student Portal Navigation"
        className="fixed bottom-3 left-1/2 z-40 w-[min(92vw,420px)] -translate-x-1/2 rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-[#2E3646] dark:bg-[#1E2430]/95"
      >
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              { id: 'HOME', label: 'Home', Icon: Home },
              { id: 'MAP', label: 'Map', Icon: MapIcon },
              { id: 'PASS', label: 'Pass', Icon: Bus },
              { id: 'MORE', label: 'More', Icon: MoreHorizontal },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = portalTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPortalTab(id)}
                className={`flex items-center justify-center gap-1.5 rounded-full py-2 text-[11px] font-extrabold transition cursor-pointer ${
                  active
                    ? 'bg-[#4F46E5] text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Transit Services Modal */}
      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl border border-[#D1D5DB] bg-white p-6 shadow-xl dark:border-[#374151] dark:bg-[#222733]">
            <h3 className="text-base font-extrabold text-[#111827] dark:text-white">
              Transit Services Desk
            </h3>
            <p className="mt-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Direct submission to the Transport Office Scrutiny Desk.
            </p>
            <form onSubmit={handleApplySubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                  Service Request Type
                </label>
                <select
                  value={applyServiceType}
                  onChange={(e) => setApplyServiceType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#D1D5DB] bg-[#F3F5F7] px-3 py-2 text-xs font-bold text-[#111827] dark:border-[#374151] dark:bg-[#2B313F] dark:text-white"
                >
                  <option value="BUS_PASS_RENEWAL">Semester Bus Pass Renewal</option>
                  <option value="ROUTE_CHANGE">Evening Alternate Drop Stop / Route Change</option>
                  <option value="FEE_GRACE_PERIOD">Transport Fee Clearance / Grace Pass</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                  Reason / Notes
                </label>
                <textarea
                  value={applyReason}
                  onChange={(e) => setApplyReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-[#D1D5DB] bg-[#F3F5F7] px-3 py-2 text-xs font-medium text-[#111827] dark:border-[#374151] dark:bg-[#2B313F] dark:text-white"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApplyModal(false)}
                  className="flex-1 rounded-xl border border-[#D1D5DB] py-2 text-xs font-bold text-[#4B5563] dark:border-[#374151] dark:text-[#9CA3AF] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-[#4F46E5] py-2 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] cursor-pointer"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phone Number Onboarding & Verification Modal */}
      <PhoneOnboardingModal
        isOpen={isPhoneModalOpen}
        onClose={() => setIsPhoneModalOpen(false)}
        userType="STUDENT"
        rollNumber={studentRoll}
        initialPhone={studentPhone}
        onSuccess={(verifiedPhone) => {
          setStudentPhone(verifiedPhone);
          setIsPhoneVerified(true);
          pushToast('success', 'Mobile Alerts Activated', `Notifications configured for +91 ${verifiedPhone}`);
        }}
      />

      {/* Live SMS & App Messages Drawer */}
      <SmsMessageDrawer
        isOpen={isSmsDrawerOpen}
        onClose={() => setIsSmsDrawerOpen(false)}
        rollNumber={studentRoll}
        userType={isFaculty ? 'FACULTY' : 'STUDENT'}
        phoneNumber={studentPhone}
      />

      {/* Mandatory Forced Password Change Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border border-amber-500/40 bg-white p-6 shadow-2xl dark:border-amber-500/30 dark:bg-[#222733]">
            <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-6 w-6" />
              <h3 className="text-base font-extrabold text-[#111827] dark:text-white">
                Update Temporary Password
              </h3>
            </div>
            <p className="mt-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Your account was provisioned with a temporary password. Security policy requires you to set a permanent password before continuing.
            </p>
            {pwError && (
              <div className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400">
                {pwError}
              </div>
            )}
            <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                  Current Temporary Password
                </label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#D1D5DB] bg-[#F3F5F7] px-3 py-2 text-xs font-bold text-[#111827] dark:border-[#374151] dark:bg-[#2B313F] dark:text-white"
                  placeholder="Current password"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                  New Permanent Password (min 10 characters)
                </label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#D1D5DB] bg-[#F3F5F7] px-3 py-2 text-xs font-bold text-[#111827] dark:border-[#374151] dark:bg-[#2B313F] dark:text-white"
                  placeholder="New password (10+ characters)"
                  minLength={10}
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#D1D5DB] bg-[#F3F5F7] px-3 py-2 text-xs font-bold text-[#111827] dark:border-[#374151] dark:bg-[#2B313F] dark:text-white"
                  placeholder="Confirm new password"
                  minLength={10}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingPw}
                className="w-full mt-2 rounded-xl bg-[#4F46E5] py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#4338CA] active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                {isSubmittingPw ? 'Updating Password...' : 'Save & Enter Student Portal'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
