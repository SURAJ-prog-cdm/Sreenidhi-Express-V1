import React, { useState } from 'react';
import {
  Users,
  GraduationCap,
  LayoutGrid,
  ArrowRight,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import { excelService } from '../../services/excelService';

type AuthRole = 'PARENT' | 'STUDENT' | 'DRIVER' | 'ADMIN';
const ENABLE_PARENT_PORTAL = import.meta.env.VITE_ENABLE_PARENT_PORTAL === 'true';

interface StudentLoginPageProps {
  initialRole?: AuthRole;
}

const StudentLoginPageComponent: React.FC<StudentLoginPageProps> = ({ initialRole }) => {
  const {
    students,
    setActiveStudentId,
    syncAuthenticatedStudent,
    setActiveView,
    buses,
    activeRouteId,
    setActiveRouteId,
    setCurrentUser,
    setIsInstallModalOpen,
  } = useCommuteSimulation();

  // Selected role from the 2x2 grid
  const normalizedInitialRole =
    !ENABLE_PARENT_PORTAL && initialRole === 'PARENT' ? 'STUDENT' : (initialRole || null);
  const [selectedRole, setSelectedRole] = useState<AuthRole | null>(normalizedInitialRole);

  // Student form state
  const [studentRoll, setStudentRoll] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [studentAuthMode, setStudentAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [regRoll, setRegRoll] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPickupStop, setRegPickupStop] = useState('Erragadda');
  const [regSuccessMsg, setRegSuccessMsg] = useState<string | null>(null);

  // Parent form state
  const [parentCode, setParentCode] = useState('');

  // Driver form state
  const [driverRoute, setDriverRoute] = useState(activeRouteId || 'route-51');
  const [driverPin, setDriverPin] = useState('');

  // Admin form state
  const [adminId, setAdminId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // Status & error states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Handle Parent Sign In: server-verified, scoped to one ward. (Was: any roll number opened the parent portal with no check.)
  const handleParentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);
    try {
      const res = await excelService.loginParent(parentCode);
      if (!res.success || !res.parent) { setAuthError(res.message); return; }
      const ward = students.find((s) => s.rollNumber.toUpperCase() === String(res.parent.wardRoll).toUpperCase());
      const effectiveRoute = res.parent.wardRouteId || ward?.routeId || 'route-51';
      if (ward) { setActiveStudentId(ward.id); }
      setActiveRouteId(effectiveRoute);
      setCurrentUser({
        role: 'PARENT', id: res.parent.id, name: res.parent.name, rollNumber: res.parent.wardRoll,
        wardName: res.parent.wardName, wardRoll: res.parent.wardRoll,
        wardRouteId: effectiveRoute,
        wardPickupStop: res.parent.wardPickupStop || ward?.pickupStopId,
        loginTime: new Date().toISOString(),
      });
      const profile = await excelService.getStudentProfile();
      if (profile) syncAuthenticatedStudent(profile);
      setActiveView('PARENT');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Student Sign In: the server decides. No demo bypass, no "local fallback" session on failure.
  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);
    try {
      const cleanRoll = studentRoll.trim().toUpperCase();
      if (!cleanRoll || !studentPassword) {
        setAuthError('Enter your Roll Number and password.');
        return;
      }
      const res = await excelService.loginStudent(cleanRoll, studentPassword);
      if (!res.success) { setAuthError(res.message); return; }
      const matched = students.find((s) => s.rollNumber.toUpperCase() === cleanRoll);
      const studentData = res.student || {};
      const assignedRoute = studentData['Assigned Route'] || studentData.routeId || matched?.routeId || 'route-51';
      setActiveStudentId(matched?.id ?? `stu-${cleanRoll}`);
      setActiveRouteId(assignedRoute);
      setCurrentUser({
        role: 'STUDENT', 
        id: matched?.id ?? `stu-${cleanRoll}`, 
        name: studentData['Student Name'] || studentData.name || matched?.name || 'Student',
        rollNumber: cleanRoll,
        wardRouteId: assignedRoute,
        wardPickupStop: studentData['Pickup Stop'] || studentData.pickupStopId || matched?.pickupStopId,
        mustChangePassword: Boolean(studentData.mustChangePassword || studentData.must_change_password),
        loginTime: new Date().toISOString(),
      });
      syncAuthenticatedStudent(studentData);
      setActiveView('STUDENT');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStudentRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setRegSuccessMsg(null);
    const cleanRoll = regRoll.trim().toUpperCase();
    const cleanPhone = regPhone.replace(/\D/g, '').slice(-10);
    if (!cleanRoll || !regName.trim() || !regEmail.trim() || !regPickupStop.trim()) {
      setAuthError('Fill in Roll Number, Full Name, College Email, and Pickup Stop.');
      return;
    }
    if (cleanPhone.length !== 10) {
      setAuthError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (regPassword.length < 8) {
      setAuthError('Password must be at least 8 characters long.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await excelService.registerStudent({
        rollNumber: cleanRoll,
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        studentPhone: cleanPhone,
        pickupStop: regPickupStop.trim(),
      });
      if (!res.success) {
        setAuthError(res.message || 'Registration failed.');
        return;
      }
      setRegSuccessMsg(
        res.message ||
          'Registration submitted! Visit the Transport Office or wait for 1-click Admin verification before signing in.',
      );
      setRegPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Driver Sign In: per-bus PIN verified server-side (was a client-side compare against '1414').
  const handleDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!driverPin || driverPin.trim().length !== 6) {
      setAuthError('Enter your Driver 6-Digit PIN.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await excelService.loginDriver(driverRoute, driverPin.trim());
      if (!res.success) { setAuthError(res.message); return; }
      setActiveRouteId(driverRoute);
      const selectedBus = buses.find((b) => b.routeId === driverRoute) || buses[0];
      setCurrentUser({
        role: 'DRIVER', 
        id: res.driver?.id ?? `driver-${driverRoute}`, 
        name: selectedBus?.driverName || res.driver?.name || 'Driver',
        wardRouteId: driverRoute,
        loginTime: new Date().toISOString(),
      });
      setActiveView('DRIVER');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Admin Sign In: server only. The credentials and the `catch` that accepted the ID alone are gone from the bundle.
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);
    try {
      const res = await excelService.loginAdmin(adminId.trim(), adminPassword);
      if (!res.success) { setAuthError(res.message || 'Invalid admin credentials.'); return; }
      setCurrentUser({ role: 'ADMIN', id: res.admin?.id ?? 'admin', name: res.admin?.name || 'Transport Office Admin', loginTime: new Date().toISOString() });
      setActiveView('ADMIN');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[85vh] w-full max-w-5xl flex-col justify-center px-1 sm:px-4 py-1 sm:py-6 antialiased">
      {/* Top Banner above card matching Screen 1 */}
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-[#4B5563] dark:text-[#9CA3AF]">
        <span className="truncate pr-2">
          {import.meta.env.DEV
            ? 'Demo build with simulated buses and sample data.'
            : 'Sreenidhi University Campus Transit Portal'}
        </span>
        <button
          type="button"
          onClick={() => setIsInstallModalOpen(true)}
          className="shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 sm:px-3 py-1 font-bold text-[#111827] shadow-xs transition hover:bg-slate-50 active:scale-95 dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white cursor-pointer"
        >
          Download app
        </button>
      </div>

      {/* Main Role Selection Card (BusTrack White-and-Indigo Theme) */}
      <div className="w-full rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-7 shadow-sm dark:border-[#2E3646] dark:bg-[#1E2430]">
        {/* App Title Header with Official Sreenidhi Express Logo */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src="/sreenidhi_express_logo.jpg"
              alt="Sreenidhi Express"
              className="h-12 w-12 rounded-2xl object-cover shadow-sm ring-1 ring-black/10 dark:ring-white/10"
            />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-[#4F46E5] dark:text-indigo-400">
              Sreenidhi Express
            </h2>
            <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
              Sreenidhi University bus app • Helpline: +91 77999 56801
            </p>
          </div>
        </div>

        {/* Big Heading */}
        <div className="mt-6 sm:mt-7">
          <h1 className="text-2xl font-extrabold tracking-tight text-[#111827] sm:text-3xl dark:text-white">
            Who are you?
          </h1>
          <p className="mt-1 text-sm font-medium text-[#4B5563] dark:text-[#9CA3AF]">
            Pick your role to log in.
          </p>
        </div>

        {/* Role Selection Grid (3-portal Phase 1 scope unless VITE_ENABLE_PARENT_PORTAL=true) */}
        <div className={`mt-5 sm:mt-6 grid gap-2.5 sm:gap-3.5 ${ENABLE_PARENT_PORTAL ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
          {/* Card 1: Parent (Phase 2 feature flag) */}
          {ENABLE_PARENT_PORTAL && (
            <button
              type="button"
              onClick={() => {
                setSelectedRole('PARENT');
                setAuthError(null);
              }}
              className={`futuristic-tile group flex flex-col justify-between rounded-2xl border p-3.5 sm:p-4 text-left cursor-pointer ${
                selectedRole === 'PARENT'
                  ? 'border-[#4F46E5] bg-indigo-50/70 ring-2 ring-[#4F46E5]/20 dark:border-indigo-400 dark:bg-indigo-950/30 futuristic-tile-active'
                  : 'border-slate-200/80 bg-[#F5F7FB] hover:border-[#4F46E5]/50 hover:bg-indigo-50/50 dark:border-[#2E3646] dark:bg-[#141821] dark:hover:bg-indigo-950/20'
              }`}
            >
              <div className="mb-3 sm:mb-4 text-[#4F46E5] dark:text-indigo-400">
                <Users className="h-6 w-6 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#111827] dark:text-white">
                  Parent
                </h3>
                <p className="mt-0.5 text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] leading-tight">
                  Follow your child&apos;s bus
                </p>
              </div>
            </button>
          )}

          {/* Card 2: Student */}
          <button
            type="button"
            onClick={() => {
              setSelectedRole('STUDENT');
              setAuthError(null);
            }}
            className={`futuristic-tile group flex flex-col justify-between rounded-2xl border p-3.5 sm:p-4 text-left cursor-pointer ${
              selectedRole === 'STUDENT'
                ? 'border-[#4F46E5] bg-indigo-50/70 ring-2 ring-[#4F46E5]/20 dark:border-indigo-400 dark:bg-indigo-950/30 futuristic-tile-active'
                : 'border-slate-200/80 bg-[#F5F7FB] hover:border-[#4F46E5]/50 hover:bg-indigo-50/50 dark:border-[#2E3646] dark:bg-[#141821] dark:hover:bg-indigo-950/20'
            }`}
          >
            <div className="mb-3 sm:mb-4 text-[#4F46E5] dark:text-indigo-400">
              <GraduationCap className="h-6 w-6 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#111827] dark:text-white">
                Student
              </h3>
              <p className="mt-0.5 text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] leading-tight">
                ETA, pass and alerts
              </p>
            </div>
          </button>

          {/* Card 3: Driver */}
          <button
            type="button"
            onClick={() => {
              setSelectedRole('DRIVER');
              setAuthError(null);
            }}
            className={`futuristic-tile group flex flex-col justify-between rounded-2xl border p-3.5 sm:p-4 text-left cursor-pointer ${
              selectedRole === 'DRIVER'
                ? 'border-[#4F46E5] bg-indigo-50/70 ring-2 ring-[#4F46E5]/20 dark:border-indigo-400 dark:bg-indigo-950/30 futuristic-tile-active'
                : 'border-slate-200/80 bg-[#F5F7FB] hover:border-[#4F46E5]/50 hover:bg-indigo-50/50 dark:border-[#2E3646] dark:bg-[#141821] dark:hover:bg-indigo-950/20'
            }`}
          >
            <div className="mb-3 sm:mb-4 text-[#4F46E5] dark:text-indigo-400">
              <svg
                className="h-6 w-6 stroke-[2.2]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
                <line x1="12" y1="2" x2="12" y2="9" />
                <line x1="12" y1="15" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="9.88" y2="9.88" />
                <line x1="14.12" y1="14.12" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-[#111827] dark:text-white">
                Driver
              </h3>
              <p className="mt-0.5 text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] leading-tight">
                Trips, stops and SOS
              </p>
            </div>
          </button>

          {/* Card 4: Admin */}
          <button
            type="button"
            onClick={() => {
              setSelectedRole('ADMIN');
              setAuthError(null);
            }}
            className={`futuristic-tile group flex flex-col justify-between rounded-2xl border p-3.5 sm:p-4 text-left cursor-pointer ${
              selectedRole === 'ADMIN'
                ? 'border-[#4F46E5] bg-indigo-50/70 ring-2 ring-[#4F46E5]/20 dark:border-indigo-400 dark:bg-indigo-950/30 futuristic-tile-active'
                : 'border-slate-200/80 bg-[#F5F7FB] hover:border-[#4F46E5]/50 hover:bg-indigo-50/50 dark:border-[#2E3646] dark:bg-[#141821] dark:hover:bg-indigo-950/20'
            }`}
          >
            <div className="mb-3 sm:mb-4 text-[#4F46E5] dark:text-indigo-400">
              <LayoutGrid className="h-6 w-6 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#111827] dark:text-white">
                Admin
              </h3>
              <p className="mt-0.5 text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] leading-tight">
                Fleet and records
              </p>
            </div>
          </button>
        </div>

        {/* Global Error Notice */}
        {authError && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <span>{authError}</span>
          </div>
        )}

        {/* Role Credentials Trays (Smoothly expands when role is selected) */}
        {ENABLE_PARENT_PORTAL && selectedRole === 'PARENT' && (
          <form onSubmit={handleParentSubmit} className="mt-5 space-y-3 rounded-2xl border border-[#D1D5DB] bg-[#F3F5F7] p-4 dark:border-[#374151] dark:bg-[#2B313F]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111827] dark:text-white">
                Parent Sign-In
              </span>
              <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                Primary Demo: Suraj (Route 51)
              </span>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                Parent Access Code
              </label>
              <input
                type="text"
                value={parentCode}
                onChange={(e) => setParentCode(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2 text-xs font-bold text-[#111827] focus:border-[#0D4B42] focus:outline-none dark:border-[#374151] dark:bg-[#222733] dark:text-white"
                placeholder="Enter 8-character parent access code"
                required
              />
            </div>
            {/* Quick Demo Parent Code */}
            {import.meta.env.DEV && (
              <div className="flex items-center justify-between rounded-xl bg-white/70 p-2 text-[11px] text-slate-700 dark:bg-black/20 dark:text-slate-300 border border-black/5 dark:border-white/5">
                <span>👨‍👩‍👧 <b>Demo Parent:</b></span>
                <button
                  type="button"
                  onClick={() => setParentCode('PARENT51')}
                  className="text-[#0D4B42] dark:text-[#4ADE80] font-mono font-bold hover:underline cursor-pointer"
                >
                  PARENT51 (Suraj — Route 51)
                </button>
              </div>
            )}
            <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
              💡 <em>Generate a 30-day code inside the Student Portal under Profile to link a parent device.</em>
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0D4B42] py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#0A3C34] active:scale-98 dark:bg-[#15803D] dark:hover:bg-[#166534] cursor-pointer"
            >
              <span>{isSubmitting ? 'Locating Bus...' : 'Track Child’s Bus'}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>
        )}

        {selectedRole === 'STUDENT' && (
          <div className="mt-5 space-y-3 rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-4 dark:border-[#2E3646] dark:bg-[#141821]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#111827] dark:text-white">
                {studentAuthMode === 'LOGIN' ? 'Student & Faculty Sign-In' : 'New Commuter Self-Registration'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setStudentAuthMode((m) => (m === 'LOGIN' ? 'REGISTER' : 'LOGIN'));
                  setAuthError(null);
                  setRegSuccessMsg(null);
                }}
                className="text-[11px] font-extrabold text-[#4F46E5] underline hover:opacity-80 dark:text-indigo-400 cursor-pointer"
              >
                {studentAuthMode === 'LOGIN' ? 'New Commuter? Self-Register' : 'Already Verified? Sign In'}
              </button>
            </div>

            {studentAuthMode === 'LOGIN' ? (
              <form onSubmit={handleStudentSubmit} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                    Roll Number / Employee ID
                  </label>
                  <input
                    type="text"
                    value={studentRoll}
                    onChange={(e) => setStudentRoll(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                    placeholder="26011CSEAI0109 or 40000116"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                    Password
                  </label>
                  <div className="relative mt-1">
                    <input
                      type={showStudentPassword ? 'text' : 'password'}
                      value={studentPassword}
                      onChange={(e) => setStudentPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="Enter your password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowStudentPassword(!showStudentPassword)}
                      className="absolute right-2.5 top-2 text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer"
                    >
                      {showStudentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {/* Quick Demo Fill Buttons */}
                {import.meta.env.DEV && (
                  <div className="rounded-xl bg-white/80 p-2 text-[11px] text-slate-700 dark:bg-black/20 dark:text-slate-300 space-y-1 border border-slate-200/80 dark:border-white/5">
                    <div className="flex items-center justify-between">
                      <span>🎓 <b>Student (Route 51):</b></span>
                      <button
                        type="button"
                        onClick={() => { setStudentRoll('26011CSEAI0109'); setStudentPassword('student123'); }}
                        className="text-[#4F46E5] dark:text-indigo-400 font-mono font-bold hover:underline cursor-pointer"
                      >
                        26011CSEAI0109 / student123
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>👩‍🏫 <b>Faculty (Route 51):</b></span>
                      <button
                        type="button"
                        onClick={() => { setStudentRoll('40000116'); setStudentPassword('faculty123'); }}
                        className="text-[#4F46E5] dark:text-indigo-400 font-mono font-bold hover:underline cursor-pointer"
                      >
                        40000116 / faculty123
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4F46E5] py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#4338CA] active:scale-98 cursor-pointer"
                >
                  <span>{isSubmitting ? 'Signing In...' : 'Sign In as Student / Faculty'}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleStudentRegister} className="space-y-2.5">
                {regSuccessMsg && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">
                    {regSuccessMsg}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                      Roll / Employee ID
                    </label>
                    <input
                      type="text"
                      value={regRoll}
                      onChange={(e) => setRegRoll(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="26011CSEAI0199"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="Your full name"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                      College Email
                    </label>
                    <input
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="name@sreenidhi.edu.in"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                      10-Digit Mobile
                    </label>
                    <input
                      type="tel"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="9876543210"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                      Password (min 8 chars)
                    </label>
                    <input
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="Create a strong password"
                      minLength={8}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                      Requested Pickup Stop
                    </label>
                    <input
                      type="text"
                      list="suh-register-stops"
                      value={regPickupStop}
                      onChange={(e) => setRegPickupStop(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      placeholder="Erragadda, KPHB, Miyapur..."
                      required
                    />
                    <datalist id="suh-register-stops">
                      <option value="Miyapur X Roads" />
                      <option value="KPHB Colony" />
                      <option value="Kukatpally" />
                      <option value="Balanagar" />
                      <option value="Moosapet" />
                      <option value="Erragadda" />
                      <option value="SR Nagar" />
                      <option value="Ameerpet" />
                      <option value="Secunderabad" />
                      <option value="Uppal X Roads" />
                      <option value="Ghatkesar" />
                    </datalist>
                  </div>
                </div>
                <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                  Transport Office verification is required before first login (no paid SMS OTP required).
                </p>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4F46E5] py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#4338CA] active:scale-98 cursor-pointer"
                >
                  <span>{isSubmitting ? 'Submitting...' : 'Submit for Transport Office Verification'}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>
            )}
          </div>
        )}

        {selectedRole === 'DRIVER' && (
          <form onSubmit={handleDriverSubmit} className="mt-5 space-y-3 rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-4 dark:border-[#2E3646] dark:bg-[#141821]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111827] dark:text-white">
                Driver Cabin Access
              </span>
              <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                Bus PIN
              </span>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                Assigned Route
              </label>
              <select
                value={driverRoute}
                onChange={(e) => setDriverRoute(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
              >
                {buses.map((b) => (
                  <option key={b.routeId} value={b.routeId}>
                    {b.routeNumber} ({b.registrationNo}) — {b.driverName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                Driver 6-Digit PIN
              </label>
              <input
                type="password"
                maxLength={6}
                value={driverPin}
                onChange={(e) => setDriverPin(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-mono font-bold tracking-widest text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                placeholder="515151"
                required
              />
            </div>
            {/* Quick Demo Fill Buttons */}
            {import.meta.env.DEV && (
              <div className="rounded-xl bg-white/80 p-2 text-[11px] text-slate-700 dark:bg-black/20 dark:text-slate-300 space-y-1 border border-slate-200/80 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <span>🚍 <b>Route 51 PIN:</b></span>
                  <button
                    type="button"
                    onClick={() => { setDriverRoute('route-51'); setDriverPin('515151'); }}
                    className="text-[#4F46E5] dark:text-indigo-400 font-mono font-bold hover:underline cursor-pointer"
                  >
                    515151 (TS-09-SU-5151)
                  </button>
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4F46E5] py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#4338CA] active:scale-98 cursor-pointer"
            >
              <span>{isSubmitting ? 'Opening Cabin...' : 'Enter Driver Console'}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>
        )}

        {selectedRole === 'ADMIN' && (
          <form onSubmit={handleAdminSubmit} className="mt-5 space-y-3 rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-4 dark:border-[#2E3646] dark:bg-[#141821]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111827] dark:text-white">
                Transport Office Admin
              </span>
              <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                Official admin ID
              </span>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                Admin ID
              </label>
              <input
                type="text"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                placeholder="Admin ID"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                Admin Password
              </label>
              <div className="relative mt-1">
                <input
                  type={showAdminPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#111827] focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                  placeholder="Password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword(!showAdminPassword)}
                  className="absolute right-2.5 top-2 text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer"
                >
                  {showAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {/* Quick Demo Fill Buttons */}
            {import.meta.env.DEV && (
              <div className="rounded-xl bg-white/80 p-2 text-[11px] text-slate-700 dark:bg-black/20 dark:text-slate-300 space-y-1 border border-slate-200/80 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <span>🏢 <b>Transport Office:</b></span>
                  <button
                    type="button"
                    onClick={() => { setAdminId('admin@sreenidhi.edu.in'); setAdminPassword('admin123'); }}
                    className="text-[#4F46E5] dark:text-indigo-400 font-mono font-bold hover:underline cursor-pointer"
                  >
                    admin@sreenidhi.edu.in / admin123
                  </button>
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4F46E5] py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#4338CA] active:scale-98 cursor-pointer"
            >
              <span>{isSubmitting ? 'Authenticating...' : 'Enter Transport Office'}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>
        )}

        {/* Bottom Disclaimer matching Screen 1 */}
        <p className="mt-8 text-center text-xs font-normal leading-relaxed text-[#4B5563] dark:text-[#9CA3AF]">
          By signing in you agree that a child&apos;s bus location is shared only with
          that child&apos;s parent and the transport office during an active trip.
        </p>
      </div>
    </div>
  );
};

export const StudentLoginPage = React.memo(StudentLoginPageComponent);
