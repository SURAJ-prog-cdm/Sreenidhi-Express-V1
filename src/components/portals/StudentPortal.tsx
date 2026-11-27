import React, { useState, useEffect } from 'react';
import {
  LogOut,
  CreditCard,
  Phone,
  PhoneCall,
  Clock,
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

function isMorningIstShift(): boolean {
  const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  return istHour < 12;
}

function formatProjectedIstClock(etaSec: number): string {
  const arrival = new Date(Date.now() + Math.max(0, etaSec) * 1000);
  return arrival
    .toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
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
  const [applyServiceType, setApplyServiceType] = useState('ROUTE_CHANGE');
  const [applyReason, setApplyReason] = useState('Requesting route or drop stop update.');

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

  // v20.2 Portal Tab & Hybrid Self-Check-In State
  const [portalTab, setPortalTab] = useState<'HOME' | 'MAP' | 'HELP' | 'MORE'>('HOME');
  const [showAbsenceBar, setShowAbsenceBar] = useState(false);
  const [isSelfCheckingIn, setIsSelfCheckingIn] = useState(false);
  const [localSelfBoarded, setLocalSelfBoarded] = useState(false);

  // Absence State ("Not Travelling" + 1h Pre-Departure Cutoff)
  const [isAbsentTomorrow, setIsAbsentTomorrow] = useState(false);
  const [absenceDay, setAbsenceDay] = useState<'TODAY' | 'TOMORROW'>('TOMORROW');
  const [absenceLocked, setAbsenceLocked] = useState(false);
  const [absenceLockReason, setAbsenceLockReason] = useState<string | null>(null);
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

  // Load backend contact & bus states on mount
  useEffect(() => {
    let mounted = true;

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

  const getAbsenceLockMessage = (reason: string | null) => {
    if (reason === 'ADMIN_LOCKED') {
      return 'Locked by Transport Office — Admin can unlock under Fleet';
    }
    if (reason === 'TRIP_RUNNING') {
      return 'Trip already in progress — switch to Tomorrow to opt out';
    }
    return 'Closed within 1h of departure — switch to Tomorrow or contact Transport Office';
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
        setAbsenceLockReason(res.lockReason ?? null);
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
    if (res.locked) {
      setAbsenceLocked(true);
      setAbsenceLockReason(res.lockReason ?? null);
    } else if (res.success) {
      setAbsenceLocked(false);
      setAbsenceLockReason(res.lockReason ?? null);
    }
    if (res.success) {
      setIsAbsentTomorrow(nextState);
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
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-28 antialiased">
      {/* Two-Row Greeting Header (Always Visible at Top, Zero Truncation) */}
      <div className="prismatic-card rounded-3xl p-3.5 sm:p-4">
        {/* Row 1: Logo + Unclipped Greeting + Bell / Logout */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="rounded-full bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] p-0.5 shadow-sm shrink-0">
              <img
                src="/sreenidhi_express_logo.jpg"
                alt="Sreenidhi Express Logo"
                className="h-10 w-10 rounded-full object-cover"
              />
            </div>
            <h1 className="text-sm sm:text-base font-extrabold leading-snug tracking-tight text-slate-900 dark:text-white">
              Welcome Back, {firstName}
            </h1>
          </div>

          {/* Circular Notification Bell & Logout Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsSmsDrawerOpen(true)}
              className="tactile-btn relative flex h-9 w-9 items-center justify-center rounded-full border border-indigo-100 bg-[#F7F9FF] text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-300 dark:hover:text-cyan-300 cursor-pointer"
              title="Live Transit SMS & App Messages"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#06B6D4] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#06B6D4]"></span>
              </span>
            </button>
            <button
              type="button"
              onClick={logoutUser}
              className="tactile-btn flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-[#F7F9FF] text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Full Roll Number / Employee ID + Route Pill */}
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-[#2E3646] flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300 break-all">
            {isFaculty ? 'Employee ID' : 'Roll No'}: {studentRoll}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200/80 bg-indigo-50/90 px-2.5 py-0.5 text-[10px] font-extrabold text-[#4F46E5] dark:border-indigo-700/50 dark:bg-indigo-950/60 dark:text-indigo-300 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
            Route {routeNum} • SUH Campus
          </span>
        </div>
      </div>

      {/* 2-Minute Stop Arrival Countdown & Not Coming Opt-Out Action */}
      {arrivalStage === 'ARRIVED_2_MIN_TIMER' && twoMinCountdownSec > 0 && (
        <div className="rounded-3xl border border-amber-400/50 bg-amber-50/95 p-3.5 shadow-sm dark:bg-amber-950/40 dark:border-amber-700/60 animate-pulse">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="text-xs font-black uppercase text-amber-800 dark:text-amber-200">
                  Bus at {assignedStopName} (2-Min Timer)
                </p>
                <p className="font-mono-timer text-base font-black text-amber-900 dark:text-white">
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
              className="tactile-btn rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-rose-700 cursor-pointer shrink-0"
            >
              Not Coming
            </button>
          </div>
        </div>
      )}

      {/* Proactive Proximity Heads-Up Departure Banner */}
      {countdownSec > 0 && countdownSec <= 120 && (
        <div className="flex items-center gap-2.5 rounded-3xl border border-cyan-400/40 bg-cyan-50/95 p-3 text-xs font-bold text-cyan-900 shadow-sm dark:bg-cyan-950/50 dark:text-cyan-200 animate-pulse">
          <BellRing className="h-4 w-4 shrink-0 text-[#06B6D4]" />
          <span>Bus arriving at {assignedStopName} now! Head to the boarding point.</span>
        </div>
      )}
      {countdownSec > 120 && countdownSec <= 600 && (
        <div className="flex items-center gap-2.5 rounded-3xl border border-amber-400/40 bg-amber-50/95 p-3 text-xs font-bold text-amber-900 shadow-sm dark:bg-amber-950/50 dark:text-amber-200">
          <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>10-Minute Heads-Up: Bus is ~{Math.round(countdownSec / 60)} mins away. Leave for your stop!</span>
        </div>
      )}

      {portalTab === 'HOME' && (
        <div className="animate-panel-in space-y-4">
          {/* Primary Electric Indigo -> Cyan Hero Card */}
          <div className="electric-hero rounded-3xl p-5 text-white">
            <div className="bg-futuristic-grid pointer-events-none absolute inset-0 opacity-25" />

            {/* Top row */}
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/18 backdrop-blur-xs">
                  <Bus className="h-4 w-4 text-white" />
                </span>
                <span className="text-sm font-extrabold tracking-tight">Bus #{routeNum}</span>
              </div>
              {busDelayMinutes > 0 ? (
                <span className="inline-flex items-center rounded-full bg-amber-400/25 px-3 py-1 text-[11px] font-extrabold text-amber-50 ring-1 ring-amber-200/50 backdrop-blur-xs">
                  +{busDelayMinutes}m Delay
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/18 px-3 py-1 text-[11px] font-extrabold text-white ring-1 ring-white/30 backdrop-blur-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)] animate-pulse" />
                  On Time
                </span>
              )}
            </div>

            {/* Split Metric Row */}
            <div className="relative mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-white/15 bg-white/12 p-3.5 backdrop-blur-md">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-indigo-100/90">Estimated Arrival:</p>
                <p className="font-mono-timer mt-0.5 text-xl sm:text-2xl font-black tracking-tight text-white">
                  {heroEtaLabel}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-cyan-100/95 truncate">
                  ±2 min buffer • {clockWindowLabel}
                </p>
              </div>
              <div className="min-w-0 border-l border-white/20 pl-3">
                <p className="text-[11px] font-semibold text-indigo-100/90">Next Stop:</p>
                <p className="mt-0.5 text-base sm:text-lg font-extrabold leading-snug text-white line-clamp-2">
                  {assignedStopName}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-cyan-100/95 truncate">
                  {etaDetails.distanceText} • {etaDetails.source}
                </p>
              </div>
            </div>

            {/* Bottom 2-Button Action Row */}
            <div className="relative mt-4 flex items-center gap-2.5">
              {isOnBoardCleared ? (
                <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-400/25 px-4 py-2.5 text-xs font-extrabold text-white ring-1 ring-emerald-200/60 backdrop-blur-xs">
                  On Board ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSelfCheckIn('STUDENT_SELF_TAP')}
                  disabled={isSelfCheckingIn || !isTripActive}
                  className="animate-electric-sheen tactile-btn relative flex-1 overflow-hidden rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-[#4F46E5] shadow-md transition hover:bg-indigo-50 disabled:opacity-60 cursor-pointer"
                >
                  {isSelfCheckingIn ? 'Checking In...' : isTripActive ? "I'm On Board" : 'Wait for Trip Start'}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowAbsenceBar(true);
                  if (absenceLocked) {
                    pushToast(
                      'warning',
                      'Opt-Out Locked',
                      getAbsenceLockMessage(absenceLockReason)
                    );
                  } else {
                    void handleToggleAbsence();
                  }
                }}
                disabled={isUpdatingAbsence}
                className={`tactile-btn rounded-xl px-3.5 py-2.5 text-xs font-bold backdrop-blur-xs transition disabled:opacity-60 cursor-pointer ${
                  isAbsentTomorrow
                    ? 'bg-amber-400/35 text-white ring-1 ring-amber-200/70 hover:bg-amber-400/45'
                    : 'bg-white/18 text-white ring-1 ring-white/20 hover:bg-white/28'
                }`}
              >
                {isAbsentTomorrow ? 'Absent ✓' : 'Not Traveling'}
              </button>
            </div>
          </div>

          {/* Inline Absence Day Selector & 1h Cutoff Caption */}
          {(showAbsenceBar || isAbsentTomorrow) ? (
            <div className="prismatic-card animate-panel-in rounded-3xl p-3.5">
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
                      <div className="prismatic-subcard inline-flex rounded-xl p-0.5 text-[10px] font-bold">
                        <button
                          type="button"
                          onClick={() => setAbsenceDay('TODAY')}
                          className={`rounded-lg px-2 py-0.5 cursor-pointer transition ${
                            absenceDay === 'TODAY'
                              ? 'bg-[#4F46E5] text-white shadow-2xs'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          onClick={() => setAbsenceDay('TOMORROW')}
                          className={`rounded-lg px-2 py-0.5 cursor-pointer transition ${
                            absenceDay === 'TOMORROW'
                              ? 'bg-[#4F46E5] text-white shadow-2xs'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          Tomorrow
                        </button>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {absenceLocked
                        ? getAbsenceLockMessage(absenceLockReason)
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
                      isAbsentTomorrow ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4]' : 'bg-slate-300 dark:bg-slate-700'
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
            <div className="flex items-center justify-between px-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Cutoff: 1 hour before bus departure</span>
              <button
                type="button"
                onClick={() => setShowAbsenceBar(true)}
                className="font-bold text-[#4F46E5] hover:underline dark:text-cyan-300 cursor-pointer"
              >
                Today / Tomorrow options
              </button>
            </div>
          )}

          {/* Area Cluster Bypass Notice */}
          {isClusterBypassed && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-3 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="font-bold">⚠️ Area Cluster Bypassed:</span> 100% of riders in your area marked absent. Bus uses the highway express route.
            </div>
          )}
          {isDownstreamBypass && (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-3 text-[11px] text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
              <span className="font-bold">⚡ Earlier Arrival Notice:</span> Upstream area cluster skipped. Bus may arrive 5–10 minutes earlier.
            </div>
          )}

          {/* Rounded Live Map Preview Card */}
          <div className="prismatic-card overflow-hidden rounded-3xl">
            <div className="w-full bg-[#F7F9FF] dark:bg-[#141821]">
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
              className="electric-cta flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-extrabold text-white cursor-pointer"
            >
              <span>View Full Map / Metro View →</span>
            </button>
          </div>

          {/* Compact Recent Updates + Driver Strip */}
          <div className="prismatic-card flex items-center justify-between gap-3 rounded-3xl p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#4F46E5] dark:text-cyan-300">
                Recent Updates:
              </p>
              <p className="mt-0.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
                {recentUpdateText}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Driver: <b className="text-slate-800 dark:text-slate-200">{activeBus.driverName || 'Assigned Driver'}</b> ({activeBus.driverPhone || '+91 77999 56801'})
              </p>
            </div>
            <a
              href={`tel:${activeBus.driverPhone ? activeBus.driverPhone.replace(/\s+/g, '') : '+917799956801'}`}
              title={`Call ${activeBus.driverName || 'Driver'}`}
              className="electric-cta flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
            >
              <Phone className="h-4 w-4" />
            </a>
          </div>
        </div>
      )}

      {portalTab === 'MAP' && (
        <div className="animate-panel-in space-y-4">
          <div className="prismatic-card overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-200/70 p-3.5 dark:border-[#2E3646]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#06B6D4] shadow-[0_0_8px_rgba(6,182,212,0.8)] animate-pulse" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Corridor Tracking • {routeNumber}
                </span>
              </div>

              <div className="prismatic-subcard flex items-center gap-1 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setMapMode('INTERACTIVE')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    mapMode === 'INTERACTIVE'
                      ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-xs'
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
                      ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  Metro Line
                </button>
              </div>
            </div>

            <div className="w-full bg-[#F7F9FF] dark:bg-[#141821]">
              {mapMode === 'INTERACTIVE' ? (
                <HybridTransitMap
                  buses={buses}
                  focusedBus={activeBus}
                  highlightStopId={activeStudent?.pickupStopId || activeBus.stops[0]?.id}
                  heightClass="h-80 sm:h-96 w-full"
                />
              ) : (
                <div className="h-80 sm:h-96 w-full">
                  <MetroSchematicMap
                    activeBus={activeBus}
                    highlightStopId={activeStudent?.pickupStopId || activeBus.stops[0]?.id}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Live Stop-by-Stop ETA & Projected Arrival Timestamps (Map Tab Only) */}
          <div className="prismatic-card rounded-3xl p-4 sm:p-5 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-[#2E3646]">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="h-4 w-4 shrink-0 text-[#4F46E5] dark:text-cyan-300" />
                <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Live Stop-by-Stop ETA &amp; Timestamps
                </h2>
              </div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-extrabold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300 shrink-0">
                {activeBus.stops.length} Stops • {isMorningIstShift() ? 'Morning Shift' : 'Evening Shift'}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {activeBus.stops.map((stop, idx) => {
                const isYourStop = stop.id === (activeStudent?.pickupStopId || activeBus.stops[0]?.id);
                const isNextStop = idx === activeBus.currentStopIndex;
                const isPassed = idx < activeBus.currentStopIndex;
                const scheduledStr = isMorningIstShift()
                  ? stop.scheduledMorningTime
                  : stop.scheduledEveningTime;
                const stopEtaSec = isPassed
                  ? 0
                  : calculateStopEtaSeconds(
                      activeBus.currentLat,
                      activeBus.currentLng,
                      activeBus.stops,
                      activeBus.currentStopIndex,
                      idx,
                      activeBus.speedKmh,
                      activeBus.trafficDelayMinutes,
                      learnedMedians
                    );
                const countdownText =
                  stopEtaSec <= 45
                    ? isNextStop
                      ? 'At Stop'
                      : 'Due now'
                    : `in ${Math.max(1, Math.round(stopEtaSec / 60))} min`;

                return (
                  <div
                    key={stop.id}
                    className={`prismatic-subcard flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 transition ${
                      isYourStop
                        ? 'ring-2 ring-[#4F46E5]/35 bg-indigo-50/75 dark:bg-indigo-950/35'
                        : isNextStop
                        ? 'ring-1 ring-[#06B6D4]/50 bg-cyan-50/50 dark:bg-cyan-950/25'
                        : isPassed
                        ? 'opacity-70'
                        : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-extrabold ${
                          isNextStop
                            ? 'bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] text-white shadow-xs'
                            : isYourStop
                            ? 'bg-[#4F46E5] text-white'
                            : isPassed
                            ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            : 'bg-indigo-100 text-[#4F46E5] dark:bg-indigo-950/70 dark:text-cyan-300'
                        }`}
                      >
                        {stop.sequence}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white break-words">
                            {stop.name}
                          </span>
                          {isYourStop && (
                            <span className="rounded-full bg-[#4F46E5] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                              YOUR STOP
                            </span>
                          )}
                          {isNextStop && (
                            <span className="rounded-full bg-[#06B6D4] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                              NEXT
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          Scheduled: <span className="font-mono text-slate-700 dark:text-slate-300">{scheduledStr || '—'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {isPassed ? (
                        <span className="inline-flex items-center rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          Passed
                        </span>
                      ) : (
                        <>
                          <p className="font-mono-timer text-xs font-black text-[#4F46E5] dark:text-cyan-300">
                            {countdownText}
                          </p>
                          <p className="font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            ~{formatProjectedIstClock(stopEtaSec)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
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

      {portalTab === 'HELP' && (
        <div className="animate-panel-in space-y-4">
          {/* Transport Assistance & Helpline */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-[#4F46E5] dark:text-cyan-300" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Transport Assistance &amp; Help Desk
              </h2>
            </div>

            <div className="mt-4 space-y-3">
              <div className="prismatic-subcard flex items-center justify-between rounded-2xl p-3.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Assigned Bus Driver ({routeNumber})
                  </p>
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white">
                    {activeBus.driverName || 'Assigned Driver'}
                  </p>
                  <p className="font-mono text-xs font-bold text-[#4F46E5] dark:text-cyan-300">
                    {activeBus.driverPhone || '+91 77999 56801'}
                  </p>
                </div>

                <a
                  href={`tel:${activeBus.driverPhone ? activeBus.driverPhone.replace(/\s+/g, '') : '+917799956801'}`}
                  className="electric-cta inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call Driver</span>
                </a>
              </div>

              <div className="prismatic-subcard flex items-center justify-between rounded-2xl p-3.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Sreenidhi Transport Helpline
                  </p>
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white">
                    Campus Transport Desk (SNIST)
                  </p>
                  <p className="font-mono text-xs font-bold text-[#4F46E5] dark:text-cyan-300">
                    +91 77999 56801 / +91 77999 56802
                  </p>
                </div>

                <a
                  href="tel:+917799956801"
                  className="tactile-btn inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/20"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call Helpline</span>
                </a>
              </div>

              <div className="rounded-2xl border border-dashed border-indigo-200/80 p-3 text-[11px] text-slate-500 dark:border-[#2E3646] dark:text-slate-400">
                <p>
                  <b>Campus EPABX:</b> +91 8415-395222 / 395444 • <b>General:</b> +91 9948119481
                </p>
                <p className="mt-0.5">
                  <b>Campus:</b> Yamnampet, Ghatkesar, Hyderabad - 501301 (Telangana)
                </p>
              </div>
            </div>
          </div>

          {/* Emergency SOS Flow */}
          <div className="prismatic-card rounded-3xl p-4">
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
                    className="tactile-btn flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-rose-700 cursor-pointer"
                  >
                    {isSendingSos ? 'Dispatching SOS...' : 'Yes, Send SOS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSos(false)}
                    className="tactile-btn flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 dark:border-[#2E3646] dark:text-slate-300 cursor-pointer"
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
                  className="tactile-btn rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-rose-700 cursor-pointer"
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
        <div className="animate-panel-in space-y-4">
          {ENABLE_PARENT_PORTAL && !isFaculty && (
            <div className="prismatic-card rounded-3xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-2xl bg-indigo-50 p-2.5 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
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
                  className="electric-cta rounded-xl px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingParentCode ? 'Generating...' : parentLinkCode ? 'Refresh Code' : 'Generate Code'}
                </button>
              </div>

              {parentLinkCode && (
                <div className="prismatic-subcard mt-3 rounded-2xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                      Share with Parent:
                    </span>
                    <p className="font-mono text-sm font-black text-[#4F46E5] dark:text-cyan-300 tracking-widest">
                      {parentLinkCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(parentLinkCode);
                      pushToast('success', 'Code Copied', 'Parent access code copied to clipboard.');
                    }}
                    className="tactile-btn rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-[#4F46E5] hover:bg-indigo-100 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
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
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-5 w-5 text-[#4F46E5] dark:text-cyan-300" />
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
                className="w-full rounded-2xl border border-slate-200/80 bg-[#F7F9FF] p-3 text-xs text-slate-900 outline-none focus:border-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                maxLength={280}
                required
              />
              <button
                type="submit"
                disabled={isSubmittingLost || !lostDescription.trim()}
                className="electric-cta rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
              >
                {isSubmittingLost ? 'Reporting...' : 'Report to Transport Office'}
              </button>
            </form>
          </div>

          {/* Ride Quality Feedback & 1-5 Star Rating */}
          <div className="prismatic-card rounded-3xl p-5">
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
                  className="w-full rounded-2xl border border-slate-200/80 bg-[#F7F9FF] p-3 text-xs text-slate-900 outline-none focus:border-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  maxLength={280}
                />

                <button
                  type="submit"
                  className="electric-cta rounded-xl px-4 py-2 text-xs font-bold text-white cursor-pointer"
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
              className="prismatic-card tactile-btn flex w-full items-center justify-center gap-2 rounded-3xl p-3.5 text-xs font-extrabold text-[#4F46E5] dark:text-cyan-300 cursor-pointer"
            >
              <CreditCard className="h-4 w-4 text-[#06B6D4]" />
              <span>Transit Services Desk</span>
            </button>
          </div>
        </div>
      )}

      {/* Sleek Docked 4-Tab Pill Bottom Bar */}
      <nav
        aria-label="Student Portal Navigation"
        className="fixed bottom-3 left-1/2 z-40 w-[min(92vw,420px)] -translate-x-1/2 rounded-full border border-indigo-100/90 bg-white/90 p-1.5 shadow-[0_14px_38px_-10px_rgba(79,70,229,0.28)] backdrop-blur-2xl dark:border-[#2E3646] dark:bg-[#1E2430]/92"
      >
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              { id: 'HOME', label: 'Home', Icon: Home },
              { id: 'MAP', label: 'Map', Icon: MapIcon },
              { id: 'HELP', label: 'Help', Icon: PhoneCall },
              { id: 'MORE', label: 'More', Icon: MoreHorizontal },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = portalTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPortalTab(id)}
                className={`tactile-btn flex items-center justify-center gap-1.5 rounded-full py-2 text-[11px] font-extrabold transition cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-sm shadow-indigo-500/25'
                    : 'text-slate-500 hover:bg-indigo-50/70 hover:text-[#4F46E5] dark:text-slate-400 dark:hover:text-white'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-md">
          <div className="prismatic-card animate-panel-in w-full max-w-sm rounded-3xl p-6">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              Transit Services Desk
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Direct submission to the Transport Office Scrutiny Desk.
            </p>
            <form onSubmit={handleApplySubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Service Request Type
                </label>
                <select
                  value={applyServiceType}
                  onChange={(e) => setApplyServiceType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                >
                  <option value="ROUTE_CHANGE">Evening Alternate Drop Stop / Route Change</option>
                  <option value="EXAM_SHUTTLE">Special / Exam Shuttle Request</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Reason / Notes
                </label>
                <textarea
                  value={applyReason}
                  onChange={(e) => setApplyReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApplyModal(false)}
                  className="tactile-btn flex-1 rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 dark:border-[#2E3646] dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="electric-cta flex-1 rounded-xl py-2 text-xs font-bold text-white cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-md">
          <div className="prismatic-card animate-panel-in w-full max-w-sm rounded-3xl border-amber-300/80 p-6">
            <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-6 w-6" />
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Update Temporary Password
              </h3>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Your account was provisioned with a temporary password. Security policy requires you to set a permanent password before continuing.
            </p>
            {pwError && (
              <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs font-semibold text-rose-600 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400">
                {pwError}
              </div>
            )}
            <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Current Temporary Password
                </label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  placeholder="Current password"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  New Permanent Password (min 10 characters)
                </label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  placeholder="New password (10+ characters)"
                  minLength={10}
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  placeholder="Confirm new password"
                  minLength={10}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingPw}
                className="electric-cta w-full mt-2 rounded-xl py-2.5 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
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
