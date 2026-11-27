import React, { useState, useEffect } from 'react';
import {
  Phone,
  PhoneCall,
  Send,
  LogOut,
  CalendarX,
  PackageSearch,
  AlertTriangle,
  Bell,
} from 'lucide-react';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import { MetroSchematicMap } from '../map/MetroSchematicMap';
import { excelService } from '../../services/excelService';
import { calculateStopEtaSeconds, getGoogleMapsLiveEta } from '../../services/mapsService';
import { PhoneOnboardingModal } from '../notifications/PhoneOnboardingModal';
import { LiveTransitTracker } from '../notifications/LiveTransitTracker';
import { MobileAlertCard } from '../notifications/MobileAlertCard';
import { SmsMessageDrawer } from '../notifications/SmsMessageDrawer';

export const ParentPortal: React.FC = () => {
  const {
    activeStudent,
    activeBus,
    currentUser,
    logoutUser,
    pushToast,
    routeOptimizationPlan,
    setAbsenceTomorrow,
  } = useCommuteSimulation();

  const [isAbsentTomorrow, setIsAbsentTomorrow] = useState(false);
  const [isUpdatingAbsence, setIsUpdatingAbsence] = useState(false);
  const [openIncidents, setOpenIncidents] = useState<any[]>([]);
  const [lostDescription, setLostDescription] = useState('');
  const [isSubmittingLost, setIsSubmittingLost] = useState(false);

  // Mobile Phone & E-Commerce Alerts State
  const [parentPhone, setParentPhone] = useState<string>('');
  const [isPhoneVerified, setIsPhoneVerified] = useState<boolean>(true);
  const [isPhoneModalOpen, setIsPhoneModalOpen] = useState<boolean>(false);
  const [isSmsDrawerOpen, setIsSmsDrawerOpen] = useState<boolean>(false);
  const [busDelayMinutes, setBusDelayMinutes] = useState<number>(0);
  const [isTripActive, setIsTripActive] = useState<boolean>(true);
  const [isSendingTestNotif, setIsSendingTestNotif] = useState<boolean>(false);

  // Active student ward (strictly derived from authenticated parent session)
  const studentName = currentUser?.role === 'PARENT' ? (currentUser.wardName || activeStudent?.name || 'Student') : (activeStudent?.name || 'Student');
  const studentRoll = currentUser?.role === 'PARENT' ? (currentUser.wardRoll || activeStudent?.rollNumber || '') : (activeStudent?.rollNumber || '');
  const wardRouteId = (currentUser as any)?.wardRouteId || activeBus?.routeId || 'route-51';
  const routeNumber = activeBus?.routeNumber || wardRouteId.replace('route-', 'Route ');
  const pickupStopName = (currentUser as any)?.wardPickupStop || activeStudent?.pickupStopId || 'Assigned Stop';
  const driverName = activeBus?.driverName || 'Designated Driver';
  const driverPhone = activeBus?.driverPhone || '+91 77999 56801';

  const studentStop = activeBus?.stops?.find(
    (s: any) => s.name === pickupStopName || s.id === activeStudent?.pickupStopId
  );
  const highlightStopId = studentStop?.id || activeStudent?.pickupStopId || activeBus?.stops[0]?.id || '';

  const [countdownSec, setCountdownSec] = useState<number>(720);
  const [learnedMedians, setLearnedMedians] = useState<Record<string, { medianSec: number; sampleCount: number }>>({});
  const [etaSource, setEtaSource] = useState<string>('Live GPS + Road ETA');

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
      const targetStop =
        studentStop ||
        activeBus?.stops?.find((s: any) => s.id === highlightStopId) ||
        activeBus?.stops?.[0];
      if (!activeBus || !targetStop) return;

      const targetStopIndex = activeBus.stops.findIndex((s: any) => s.id === targetStop.id);
      const safeTargetIndex = targetStopIndex >= 0 ? targetStopIndex : 0;

      const res = await getGoogleMapsLiveEta(
        { lat: activeBus.currentLat, lng: activeBus.currentLng },
        { lat: targetStop.lat, lng: targetStop.lng },
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
        setEtaSource(finalSource);
      }
    };
    void calculateEta();
    return () => {
      isMounted = false;
    };
  }, [
    activeBus?.currentLat,
    activeBus?.currentLng,
    activeBus?.speedKmh,
    activeBus?.trafficDelayMinutes,
    activeBus?.currentStopIndex,
    activeBus?.stops,
    highlightStopId,
    studentStop,
    learnedMedians,
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatHms = (totalSeconds: number): string => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  const displayCountdownHms = formatHms(countdownSec);

  const busCurrentStopIndex = activeBus?.currentStopIndex ?? 0;
  const nextStopName =
    activeBus?.stops[Math.min(busCurrentStopIndex + 1, Math.max((activeBus?.stops?.length || 1) - 1, 0))]?.name ||
    'Sreenidhi Campus';

  // Load absence, incidents, contact info & bus state on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const abs = await excelService.getAbsenceTomorrow(studentRoll);
      if (mounted) setIsAbsentTomorrow(abs.absentTomorrow);
      const incs = await excelService.fetchIncidents(true);
      if (mounted) setOpenIncidents(incs.filter((i) => i.route_id === wardRouteId || i.route_id === 'ALL'));
    })();

    excelService.getContactInfo(studentRoll)
      .then((data) => {
        if (mounted && data && data.parentPhone) {
          setParentPhone(data.parentPhone);
          setIsPhoneVerified(Boolean(data.parentPhoneVerified));
        } else if (mounted) {
          const prompted = sessionStorage.getItem('parent_phone_prompted');
          if (!prompted) {
            setIsPhoneModalOpen(true);
            sessionStorage.setItem('parent_phone_prompted', '1');
          }
        }
      })
      .catch((err) => console.error('Failed to load parent contact info', err));

    excelService.getBusState(wardRouteId)
      .then((data) => {
        if (mounted && data && data.success) {
          setIsTripActive(data.running ?? true);
          setBusDelayMinutes(data.delayMinutes || 0);
        }
      })
      .catch((err) => console.error('Failed to load bus state', err));

    return () => {
      mounted = false;
    };
  }, [studentRoll, wardRouteId]);

  const handleToggleAbsence = async () => {
    setIsUpdatingAbsence(true);
    const nextState = !isAbsentTomorrow;
    const res = await setAbsenceTomorrow(studentRoll, nextState);
    setIsUpdatingAbsence(false);
    if (res.success) {
      setIsAbsentTomorrow(nextState);
    }
  };

  const handleSubmitLost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lostDescription.trim()) return;
    setIsSubmittingLost(true);
    const ok = await excelService.reportLostItem(lostDescription.trim(), `Parent of ${studentName} (${studentRoll})`);
    setIsSubmittingLost(false);
    if (ok) {
      setLostDescription('');
      pushToast('success', 'Reported to Transport Office', 'The transport desk has received your item report.');
    }
  };

  const handleTestAppNotification = async () => {
    setIsSendingTestNotif(true);
    pushToast('info', 'Dispatching In-App Alert', 'Generating test notification for your ward...');
    try {
      const res = await excelService.testParentNotification(studentRoll);
      if (res.success) {
        pushToast('success', 'In-App Alert Received', `Safety notification logged for ${studentName}.`);
        setIsSmsDrawerOpen(true);
      } else {
        pushToast('danger', 'Dispatch Failed', 'Could not dispatch test notification.');
      }
    } catch {
      pushToast('danger', 'Network Error', 'Failed to reach notifications server.');
    } finally {
      setIsSendingTestNotif(false);
    }
  };

  const handleOpenWhatsApp = () => {
    const cleanDigits = (parentPhone || '').replace(/\D/g, '').slice(-10);
    if (!cleanDigits || cleanDigits.length < 10) {
      pushToast('warning', 'Phone Number Required', 'Please configure your 10-digit WhatsApp phone number first.');
      setIsPhoneModalOpen(true);
      return;
    }
    const message = `Sreenidhi Express Transport Alert: Live bus tracking and arrival updates for student ${studentName} (${studentRoll}) on ${routeNumber}. View status: ${window.location.origin}`;
    const url = `https://wa.me/91${cleanDigits}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    pushToast('success', 'WhatsApp Alert Opened', `Drafted WhatsApp safety alert for +91 ${cleanDigits}`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-12 antialiased">
      {/* Top Header Card */}
      <div className="prismatic-card flex items-center justify-between rounded-3xl p-4">
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h1 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
              {studentName}
            </h1>
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-[#4F46E5] dark:border-indigo-700/50 dark:bg-indigo-950/60 dark:text-cyan-300">
              Verified Rider
            </span>
          </div>
          <p className="font-mono text-xs font-bold text-[#4F46E5] dark:text-cyan-300">
            Roll No: {studentRoll}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Parent Oversight • {routeNumber}
          </p>
        </div>

        {/* Top-Right Corner: SMS Bell, Sign Out & Official Brand Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsSmsDrawerOpen(true)}
            className="tactile-btn relative rounded-2xl border border-slate-200 p-2 text-slate-600 transition hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:text-slate-300 dark:hover:bg-[#2B313F] cursor-pointer"
            title="Live Transit SMS & App Messages"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#06B6D4] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#06B6D4]"></span>
            </span>
          </button>
          <button
            type="button"
            onClick={logoutUser}
            className="tactile-btn rounded-2xl border border-slate-200 p-2 text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 dark:border-[#2E3646] dark:text-slate-300 dark:hover:bg-[#2B313F] cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          <div className="rounded-2xl bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] p-0.5">
            <img
              src="/sreenidhi_express_logo.jpg"
              alt="Sreenidhi Express Logo"
              className="h-11 w-11 rounded-[14px] object-cover"
            />
          </div>
        </div>
      </div>

      {/* Open SOS / Safety Alert Feed */}
      {openIncidents.length > 0 && (
        <div className="space-y-2">
          {openIncidents.map((inc) => (
            <div
              key={inc.id}
              className="flex items-start gap-2.5 rounded-2xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p className="font-extrabold uppercase tracking-wider">{inc.kind} ALERT ON {inc.route_id}</p>
                <p className="mt-0.5 text-[11px]">{inc.msg}</p>
                <p className="text-[10px] text-rose-700/80 dark:text-rose-400 mt-0.5">
                  Reported at {new Date(inc.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} • Transport desk notified
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live Transit Milestone Tracker */}
      <LiveTransitTracker
        routeId={activeBus?.routeId || wardRouteId}
        routeName={activeBus?.routeName || 'Campus Express'}
        pickupStop={pickupStopName}
        isTripStarted={isTripActive}
        delayMinutes={busDelayMinutes}
        formattedCountdown={displayCountdownHms}
        studentName={studentName}
        rollNumber={studentRoll}
      />

      {/* Remote Absence Control for Ward */}
      <div className="prismatic-card space-y-2 rounded-3xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-xl p-2 ${isAbsentTomorrow ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-indigo-50 text-[#4F46E5] dark:bg-slate-800 dark:text-cyan-300'}`}>
              <CalendarX className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  Mark child not travelling tomorrow
                </p>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-[#4F46E5] dark:bg-slate-800 dark:text-slate-400">
                  Cutoff: 1 hour before bus departure
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isAbsentTomorrow ? 'Bus driver notified not to wait at stop' : 'Driver and transport desk will not expect student'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleAbsence}
            disabled={isUpdatingAbsence}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isAbsentTomorrow ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4]' : 'bg-slate-300 dark:bg-slate-700'
            }`}
            role="switch"
            aria-checked={isAbsentTomorrow}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                isAbsentTomorrow ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Dynamic Area Reroute Live Status for Ward */}
        {(() => {
          const wardClusterId = activeStudent?.areaClusterId || studentStop?.areaClusterId || '';
          const isClusterBypassed = Boolean(
            routeOptimizationPlan?.skippedClusterIds?.includes(wardClusterId)
          );
          const isDownstreamBypass = Boolean(
            routeOptimizationPlan?.skippedClusterIds?.length &&
            !isClusterBypassed &&
            activeBus?.stops.some(
              (s: any) => s.sequence < (studentStop?.sequence || 99) && routeOptimizationPlan.skippedClusterIds.includes(s.areaClusterId)
            )
          );

          if (isClusterBypassed) {
            return (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-bold">⚠️ Ward Area Cluster Bypassed:</span> All registered riders in this area marked absent. Morning bus will skip this stop and use the highway express corridor.
              </div>
            );
          }
          if (isDownstreamBypass) {
            return (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 text-[11px] text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                <span className="font-bold">⚡ Earlier Pickup Alert:</span> An upstream area cluster is skipped tomorrow morning. Bus may arrive 5–10 minutes earlier than normal.
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Live Commute Status Card */}
      <div className="electric-hero rounded-3xl p-5 text-white">
        <div className="bg-futuristic-grid pointer-events-none absolute inset-0 opacity-20" />
        <div className="relative flex items-start justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-100/85">
              Live Commute Status
            </span>
            <h2 className="mt-0.5 text-base font-extrabold text-white">
              {routeNumber} • En Route
            </h2>
            <p className="text-xs text-cyan-100">
              Next Stop: <b className="text-white">{nextStopName}</b>
            </p>
          </div>

          <div className="rounded-2xl border border-white/25 bg-white/15 px-3 py-1.5 text-right backdrop-blur-xs">
            <span className="text-[10px] font-extrabold uppercase text-indigo-100">
              ETA ({etaSource})
            </span>
            <p className="font-mono-timer text-sm font-black text-white">
              ~{Math.max(1, Math.round(countdownSec / 60))} mins
            </p>
          </div>
        </div>

        <div className="relative mt-4 flex items-center justify-between border-t border-white/20 pt-3 text-xs text-indigo-100">
          <span>Assigned Pickup: <b className="text-white">{pickupStopName}</b></span>
          <span>Speed: <b className="font-mono text-white">{activeBus.speedKmh} km/h</b></span>
        </div>
      </div>

      {/* Live GPS Fleet Corridor Card */}
      <div className="prismatic-card overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-3 dark:border-[#2E3646]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#06B6D4] animate-pulse" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
              Live Route Corridor • {routeNumber}
            </span>
          </div>
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-extrabold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
            GPS Live Schematic
          </span>
        </div>

        <div className="p-2.5 sm:p-3 bg-[#F7F9FF] dark:bg-[#141821]">
          <MetroSchematicMap
            activeBus={activeBus}
            highlightStopId={highlightStopId}
          />
        </div>
      </div>

      {/* Official Sreenidhi Transport Assistance & Driver Help Desk */}
      <div className="prismatic-card rounded-3xl p-5">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-5 w-5 text-[#4F46E5] dark:text-cyan-300" />
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
            Direct Driver &amp; Campus Contacts
          </h2>
        </div>

        <div className="mt-3.5 space-y-3">
          <div className="prismatic-subcard flex items-center justify-between rounded-2xl p-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Assigned Bus Driver ({routeNumber})
              </p>
              <p className="text-xs font-extrabold text-slate-900 dark:text-white">
                {driverName}
              </p>
              <p className="font-mono text-xs font-bold text-[#4F46E5] dark:text-cyan-300">
                {driverPhone}
              </p>
            </div>

            <a
              href={`tel:${driverPhone.replace(/\s+/g, '')}`}
              className="electric-cta inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Call Driver</span>
            </a>
          </div>

          <div className="prismatic-subcard flex items-center justify-between rounded-2xl p-3">
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
              className="tactile-btn inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white/10"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Call Helpline</span>
            </a>
          </div>

          <div className="rounded-xl border border-dashed border-indigo-200/80 p-2.5 text-[11px] text-slate-500 dark:border-[#2E3646] dark:text-slate-400">
            <p>
              <b>Campus EPABX:</b> +91 8415-395222 / 395444 • <b>General:</b> +91 9948119481
            </p>
            <p className="mt-0.5">
              <b>Campus:</b> Yamnampet, Ghatkesar, Hyderabad - 501301 (Telangana)
            </p>
          </div>
        </div>
      </div>

      {/* Parent Mobile Alert Center & E-Commerce Notification Preferences */}
      <MobileAlertCard
        userType="PARENT"
        rollNumber={studentRoll}
        phoneNumber={parentPhone}
        isVerified={isPhoneVerified}
        onOpenPhoneModal={() => setIsPhoneModalOpen(true)}
        onNotificationSent={() => setIsSmsDrawerOpen(true)}
      />

      {/* Lost & Found Item Form for Parents */}
      <div className="prismatic-card p-5">
        <div className="flex items-center gap-2">
          <PackageSearch className="h-5 w-5 text-[#4F46E5] dark:text-[#06B6D4]" />
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#0F172A] dark:text-white">
            Lost Something on the Bus?
          </h2>
        </div>
        <form onSubmit={handleSubmitLost} className="mt-3 space-y-2.5">
          <textarea
            value={lostDescription}
            onChange={(e) => setLostDescription(e.target.value)}
            rows={2}
            placeholder="Describe the lost item (e.g. child left school bag or calculator on Route 14)"
            className="w-full rounded-2xl border border-indigo-100/90 bg-[#F7F9FF] p-3 text-xs text-[#0F172A] placeholder:text-slate-400 focus:border-[#4F46E5] focus:outline-hidden dark:border-[#374151] dark:bg-[#2B313F] dark:text-white"
            maxLength={280}
            required
          />
          <button
            type="submit"
            disabled={isSubmittingLost || !lostDescription.trim()}
            className="tactile-btn electric-cta px-4 py-2.5 text-xs font-extrabold disabled:opacity-50"
          >
            {isSubmittingLost ? 'Reporting...' : 'Report to Transport Office'}
          </button>
        </form>
      </div>

      {/* Quick Action / Safety Alerts */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleTestAppNotification}
          disabled={isSendingTestNotif}
          className="tactile-btn prismatic-subcard flex items-center justify-center gap-2 py-3 px-3 text-xs font-extrabold text-[#0F172A] hover:border-[#4F46E5]/40 hover:bg-indigo-50/60 dark:text-white dark:hover:bg-[#323A4A]"
        >
          <Bell className="h-4 w-4 text-[#4F46E5] dark:text-[#06B6D4]" />
          <span>{isSendingTestNotif ? 'Sending...' : 'Send Test App Notification'}</span>
        </button>

        <button
          type="button"
          onClick={handleOpenWhatsApp}
          className="tactile-btn flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-3 px-3 text-xs font-extrabold text-emerald-700 shadow-xs transition hover:bg-emerald-500/20 dark:text-emerald-300 cursor-pointer"
        >
          <Send className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span>Open WhatsApp Alert</span>
        </button>
      </div>

      {/* Parent Phone Number Onboarding & Verification Modal */}
      <PhoneOnboardingModal
        isOpen={isPhoneModalOpen}
        onClose={() => setIsPhoneModalOpen(false)}
        userType="PARENT"
        rollNumber={studentRoll}
        initialPhone={parentPhone}
        onSuccess={(verifiedPhone) => {
          setParentPhone(verifiedPhone);
          setIsPhoneVerified(true);
          pushToast('success', 'Parent Mobile Alerts Configured', `Notifications configured for +91 ${verifiedPhone}`);
        }}
      />

      {/* Live SMS & App Messages Drawer */}
      <SmsMessageDrawer
        isOpen={isSmsDrawerOpen}
        onClose={() => setIsSmsDrawerOpen(false)}
        rollNumber={studentRoll}
        userType="PARENT"
        phoneNumber={parentPhone}
      />
    </div>
  );
};
