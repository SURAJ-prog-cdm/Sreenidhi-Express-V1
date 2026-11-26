import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  ShieldCheck,
  LogOut,
  AlertTriangle,
  Bell,
  Trash2,
  PackageSearch,
  Star,
  Download,
  CheckCircle2,
  Send,
  RotateCcw,
  Lock,
  Unlock,
  Navigation,
  Upload,
  Database,
  Key,
  Activity,
  Radio,
  HardDrive,
} from 'lucide-react';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import { HybridTransitMap } from '../map/HybridTransitMap';
import { MetroSchematicMap } from '../map/MetroSchematicMap';
import { excelService } from '../../services/excelService';

interface ScrutinyApplication {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  program: string;
  routeId: string;
  requestType: string;
  title: string;
  reason: string;
  status: 'PENDING' | 'PENDING_SCRUTINY' | 'APPROVED' | 'REJECTED';
}

export const AdminDashboard: React.FC = () => {
  const {
    currentUser,
    buses,
    activeBus,
    activeRouteId,
    setActiveRouteId,
    routeOptimizationPlan,
    setClusterOptimizationOverride,
    toggleRoutePlanLock,
    logoutUser,
    downloadMasterExcel,
    pushToast,
  } = useCommuteSimulation();

  const totalFleetBuses = buses.length || 1;
  const onTimeBusesCount = buses.filter((b) => (b.trafficDelayMinutes || 0) <= 5).length;
  const fleetPunctualityPct = Math.round((onTimeBusesCount / totalFleetBuses) * 100);
  const totalDelayMinutes = buses.reduce((acc, b) => acc + (b.trafficDelayMinutes || 0), 0);
  const avgFleetDelayMin = (totalDelayMinutes / totalFleetBuses).toFixed(1);

  const [adminTab, setAdminTab] = useState<'VERIFY' | 'FLEET' | 'LOGS'>('VERIFY');
  const [mapMode, setMapMode] = useState<'INTERACTIVE' | 'SCHEMATIC'>('INTERACTIVE');
  const [applications, setApplications] = useState<ScrutinyApplication[]>([]);
  const [scrutinyLoadingId, setScrutinyLoadingId] = useState<string | null>(null);

  // Real-time backend incident queue
  const [incidents, setIncidents] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [newAnnouncementText, setNewAnnouncementText] = useState('');
  const [newAnnouncementRoute, setNewAnnouncementRoute] = useState('ALL');
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState(false);

  // Lost and found queue
  const [lostItems, setLostItems] = useState<any[]>([]);

  // Ride feedback
  const [feedbackList, setFeedbackList] = useState<any[]>([]);

  // Bulk Excel Onboarding & Live SQLite Backup State
  const [isImportingRoster, setIsImportingRoster] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState<{
    createdCount: number;
    skippedExistingCount: number;
    errors: any[];
    credentials: any[];
  } | null>(null);
  const [pendingVerifications, setPendingVerifications] = useState<Array<{
    roll_number: string;
    name: string;
    email: string;
    student_phone: string;
    pickup_stop: string;
    registered_at: string;
    verification_status: string;
  }>>([]);
  const [verifyRouteChoice, setVerifyRouteChoice] = useState<Record<string, string>>({});
  const [verifyingRoll, setVerifyingRoll] = useState<string | null>(null);
  const [isBackupLoading, setIsBackupLoading] = useState(false);
  const [serverHealth, setServerHealth] = useState<{
    activeSseClients: number;
    liveRoutes: number;
    staleRoutes: string[];
    walBytes: number;
    lastBackupFile: string | null;
    lastBackupAt: number | null;
    uptimeSec: number;
    memoryMb: number;
  } | null>(null);
  const [isHealthRefreshing, setIsHealthRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchHealth = async () => {
    setIsHealthRefreshing(true);
    try {
      const data = await excelService.getAdminHealth();
      if (data) setServerHealth(data);
    } catch {
      // Ignore
    } finally {
      setIsHealthRefreshing(false);
    }
  };

  const reloadData = async () => {
    void fetchHealth();
    const incs = await excelService.fetchIncidents(false);
    setIncidents(incs);
    const anns = await excelService.fetchAnnouncements();
    setAnnouncements(anns);
    const lost = await excelService.fetchLostItems(false);
    setLostItems(lost);
    const fb = await excelService.fetchFeedback();
    setFeedbackList(fb);
    const liveApps = await excelService.fetchApplications();
    if (Array.isArray(liveApps)) {
      setApplications(
        liveApps.map((a: any) => ({
          id: a.id,
          studentId: `stu-${a.roll_number || a.roll || a.rollNumber || '01'}`,
          studentName: a.student_name || a.name || a.studentName || 'Student',
          rollNumber: a.roll_number || a.roll || a.rollNumber || '',
          program: a.program || 'B.Tech Undergrad',
          routeId: a.route_id || a.routeId || 'route-51',
          requestType: a.request_type || a.requestType || 'ROUTE_CHANGE',
          title: a.title || 'Transport Service Request',
          reason: a.description || a.reason || '',
          status: a.status === 'PENDING_SCRUTINY' ? 'PENDING' : (a.status || 'PENDING'),
        }))
      );
    }
    const pv = await excelService.listPendingVerifications();
    setPendingVerifications(pv);
    setVerifyRouteChoice((prev) => {
      const next = { ...prev };
      for (const row of pv) {
        if (!next[row.roll_number]) next[row.roll_number] = 'route-51';
      }
      return next;
    });
  };

  const handleVerifyRegistration = async (rollNumber: string, approved: boolean) => {
    setVerifyingRoll(rollNumber);
    const chosenRoute = verifyRouteChoice[rollNumber] || 'route-51';
    try {
      const res = await excelService.verifyStudentRegistration(rollNumber, {
        approved,
        routeId: approved ? chosenRoute : undefined,
      });
      if (res.success) {
        pushToast(
          approved ? 'success' : 'warning',
          approved ? 'Rider Verified' : 'Registration Rejected',
          approved
            ? `${rollNumber} approved and assigned to ${chosenRoute}.`
            : `${rollNumber} rejected from active boarding manifest.`
        );
        await reloadData();
      } else {
        pushToast('danger', 'Verification Failed', res.message || 'Could not update student status.');
      }
    } finally {
      setVerifyingRoll(null);
    }
  };

  useEffect(() => {
    void reloadData();
  }, []);

  const handleResolveIncident = async (id: number) => {
    const ok = await excelService.resolveIncident(id);
    if (ok) {
      pushToast('success', 'Incident Resolved', `Incident #${id} marked as resolved and archived.`);
      void reloadData();
    }
  };

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnouncementText.trim()) return;
    setIsPostingAnnouncement(true);
    const ok = await excelService.createAnnouncement(newAnnouncementText.trim(), newAnnouncementRoute);
    setIsPostingAnnouncement(false);
    if (ok) {
      setNewAnnouncementText('');
      pushToast('success', 'Announcement Broadcasted', 'Message pushed to student & parent feeds.');
      void reloadData();
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    const ok = await excelService.deleteAnnouncement(id);
    if (ok) {
      pushToast('info', 'Announcement Retracted', 'Announcement removed from active feeds.');
      void reloadData();
    }
  };

  const handleResolveLost = async (id: number) => {
    const ok = await excelService.resolveLostItem(id);
    if (ok) {
      pushToast('success', 'Lost Item Resolved', `Item #${id} marked as returned to owner.`);
      void reloadData();
    }
  };

  const handleDownloadCsv = async (type: 'incidents' | 'feedback' | 'absences' | 'lost' | 'boardings' | 'driver_utility') => {
    try {
      await excelService.downloadCsvExport(type);
      pushToast('success', 'CSV Downloaded', `${type.toUpperCase()} records exported for Excel.`);
    } catch (err: any) {
      pushToast('danger', 'Export Failed', err?.message || 'Could not download CSV export.');
    }
  };

  const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingRoster(true);
    try {
      // Dynamically import SheetJS so it stays in its own vendor chunk and never inflates mobile bundle
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);

      if (!rawRows || rawRows.length === 0) {
        pushToast('warning', 'Empty Sheet', 'No data rows found in the uploaded workbook.');
        setIsImportingRoster(false);
        return;
      }

      const mappedRiders = rawRows.map((r) => {
        const getVal = (...keys: string[]) => {
          for (const k of keys) {
            for (const rowKey of Object.keys(r)) {
              if (rowKey.trim().toLowerCase() === k.toLowerCase()) {
                return String(r[rowKey] ?? '').trim();
              }
            }
          }
          return '';
        };

        const rollNumber = getVal('Roll Number', 'roll_number', 'rollNumber', 'Employee ID', 'ID', 'Roll No');
        const name = getVal('Name', 'Student Name', 'student_name', 'Employee Name', 'Full Name');
        const program = getVal('Program', 'Department', 'Designation', 'Branch', 'Course');
        const routeId = getVal('Route', 'Route ID', 'route_id', 'routeId', 'Bus Route');
        const pickupStop = getVal('Stop', 'Pickup Stop', 'pickup_stop', 'pickupStop', 'Boarding Point', 'Stage');
        const parentPhone = getVal('Parent Phone', 'parent_phone', 'parentPhone', 'Mobile', 'Phone', 'Contact');
        const riderType = getVal('Rider Type', 'rider_type', 'riderType', 'Category', 'Role');

        return {
          rollNumber,
          name,
          program: program || 'Engineering',
          routeId: routeId || 'route-51',
          pickupStop: pickupStop || 'Campus',
          parentPhone: parentPhone || '+91 00000 00000',
          riderType: riderType.toUpperCase().includes('FACULTY') ? 'FACULTY' : 'STUDENT',
        };
      });

      const res = await excelService.bulkImportStudents(mappedRiders);
      if (res.success) {
        setBulkImportResult(res);
        pushToast(
          'success',
          'Roster Onboarded',
          `Created ${res.createdCount} new accounts (${res.skippedExistingCount} existing skipped).`
        );
      } else {
        pushToast('danger', 'Import Failed', res.errors?.[0]?.error || 'Failed to import roster.');
      }
    } catch (err: any) {
      console.error('Bulk import error:', err);
      pushToast('danger', 'Import Error', err?.message || 'Could not parse spreadsheet file.');
    } finally {
      setIsImportingRoster(false);
      e.target.value = '';
    }
  };

  const handleDownloadPinsCsv = () => {
    if (!bulkImportResult || !bulkImportResult.credentials || bulkImportResult.credentials.length === 0) {
      return;
    }
    const headers = ['Roll Number / ID', 'Name', 'Route', 'Pickup Stop', 'Rider Type', 'Temporary Password / PIN'];
    const rows = bulkImportResult.credentials.map((c) => [
      c.rollNumber,
      c.name,
      c.routeId,
      c.pickupStop,
      c.riderType,
      c.temporaryPassword,
    ]);
    const esc = (s: any) => {
      let strVal = String(s ?? '');
      if (/^[=+\-@\t\r]/.test(strVal)) strVal = "'" + strVal;
      return /[",\n\r]/.test(strVal) ? `"${strVal.replace(/"/g, '""')}"` : strVal;
    };
    const csvContent = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n') + '\r\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sreenidhi_onboarding_pins_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  };

  const handleCreateBackup = async () => {
    setIsBackupLoading(true);
    try {
      const res = await excelService.createDatabaseBackup();
      if (res.success) {
        pushToast('success', 'WAL Backup Created', `Saved ${res.fileName} (${res.backupCount} backups stored).`);
        void fetchHealth();
      } else {
        pushToast('danger', 'Backup Failed', 'Could not create SQLite backup snapshot.');
      }
    } catch {
      pushToast('danger', 'Backup Error', 'Server backup endpoint unreachable.');
    } finally {
      setIsBackupLoading(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: 'APPROVED' | 'REJECTED') => {
    setScrutinyLoadingId(id);
    try {
      const ok = await excelService.reviewApplication(id, newStatus, 'Reviewed by Transport Incharge');
      if (ok) {
        setApplications((prev) =>
          prev.map((app) => (app.id === id ? { ...app, status: newStatus } : app))
        );
        pushToast(
          newStatus === 'APPROVED' ? 'success' : 'info',
          `Application ${newStatus}`,
          `Application ${id} status saved to transport database.`
        );
      } else {
        pushToast('danger', 'Review Failed', `Could not update scrutiny status for ${id}.`);
      }
    } finally {
      setScrutinyLoadingId(null);
    }
  };

  const activeIncidentsCount = incidents.filter((i) => i.open).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-5 pb-16 antialiased">
      {/* Compact Header */}
      <div className="prismatic-card flex flex-wrap items-center justify-between gap-3 rounded-3xl p-3.5 sm:p-4">
        <div className="flex items-center gap-3 min-w-[220px] flex-1">
          <div className="rounded-full bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] p-0.5 shadow-sm shrink-0">
            <img
              src="/sreenidhi_express_logo.jpg"
              alt="Sreenidhi Express Logo"
              className="h-10 w-10 rounded-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white">
                Transport Admin
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200/80 bg-indigo-50/90 px-2.5 py-0.5 text-[11px] font-bold text-[#4F46E5] dark:border-indigo-700/50 dark:bg-indigo-950/60 dark:text-cyan-300">
                <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
                {activeBus?.routeNumber || 'Route 51'} Pilot
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Officer: <b>{currentUser?.name || 'Transport Incharge'}</b> • <code className="font-mono">SNIST-ADM-01</code>
            </p>
          </div>
        </div>

        {/* Right Actions: Master Excel & Logout */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={downloadMasterExcel}
            className="electric-cta flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Master Excel (.xlsx)</span>
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

      {/* 3-Tab Sub-Navigation */}
      <div className="prismatic-card grid grid-cols-3 gap-1.5 rounded-2xl p-1">
        {(
          [
            { id: 'VERIFY', label: 'Verify' },
            { id: 'FLEET', label: 'Fleet' },
            { id: 'LOGS', label: 'Logs' },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setAdminTab(id)}
            className={`tactile-btn rounded-xl py-2 text-xs font-extrabold transition cursor-pointer ${
              adminTab === id
                ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-sm shadow-indigo-500/20'
                : 'text-slate-500 hover:bg-indigo-50/70 hover:text-[#4F46E5] dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {adminTab === 'VERIFY' && (
        <div className="animate-panel-in space-y-4">
          {/* Electric Indigo -> Cyan Summary Hero Card */}
          <div className="electric-hero rounded-3xl p-5 text-white">
            <div className="bg-futuristic-grid pointer-events-none absolute inset-0 opacity-25" />

            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-indigo-100/90">Pending Approvals:</p>
                <p className="font-mono-timer mt-0.5 text-3xl sm:text-4xl font-black tracking-tight text-white">
                  {pendingVerifications.length}
                </p>
              </div>

              <div className="text-right">
                <span className="inline-flex items-center rounded-full bg-white/18 px-3 py-1 text-[11px] font-bold text-white ring-1 ring-white/25 backdrop-blur-xs">
                  Active Buses: {buses.length} • On-Time: {fleetPunctualityPct}%
                </span>
                <p className="mt-1.5 text-[11px] font-medium text-cyan-100/95">
                  Avg Delay: {avgFleetDelayMin}m • {activeIncidentsCount} Open Incident(s)
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleDownloadCsv('driver_utility')}
              className="animate-electric-sheen tactile-btn relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-white py-2.5 text-xs font-extrabold text-[#4F46E5] shadow-md transition hover:bg-indigo-50 cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>Export Driver Utility CSV</span>
            </button>
          </div>

          {/* Pending Verifications Card */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5 dark:border-[#2E3646]">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Pending Verifications (Self-Signup Desk)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Verify new riders with 1 click and assign them to an active route.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void reloadData()}
                className="text-xs font-bold text-[#4F46E5] hover:underline dark:text-cyan-300 cursor-pointer"
              >
                Refresh Queue
              </button>
            </div>

            <div className="mt-3.5 space-y-2.5">
              {pendingVerifications.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-indigo-200/80 p-4 text-center text-xs italic text-slate-500 dark:border-[#2E3646] dark:text-slate-400">
                  No pending self-registrations awaiting Transport Office verification.
                </p>
              ) : (
                pendingVerifications.map((stu) => (
                  <div
                    key={stu.roll_number}
                    className="prismatic-subcard flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-black text-[#4F46E5] dark:text-cyan-300 truncate">
                        {stu.roll_number} • <span className="font-sans font-bold text-slate-900 dark:text-white">{stu.pickup_stop || 'Unassigned'}</span>
                      </p>
                      <p className="mt-0.5 text-xs font-bold text-slate-900 dark:text-white">
                        {stu.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {stu.email} • Phone: <span className="font-mono">{stu.student_phone || 'N/A'}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Assign route for ${stu.roll_number}`}
                        value={verifyRouteChoice[stu.roll_number] || 'route-51'}
                        onChange={(e) =>
                          setVerifyRouteChoice((prev) => ({ ...prev, [stu.roll_number]: e.target.value }))
                        }
                        className="rounded-xl border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-white"
                      >
                        {buses.map((b) => (
                          <option key={b.routeId} value={b.routeId}>
                            {b.routeNumber} ({b.routeName})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={verifyingRoll === stu.roll_number}
                        onClick={() => void handleVerifyRegistration(stu.roll_number, true)}
                        className="tactile-btn inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 cursor-pointer"
                        title="Approve & assign route"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        disabled={verifyingRoll === stu.roll_number}
                        onClick={() => void handleVerifyRegistration(stu.roll_number, false)}
                        className="tactile-btn inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300 cursor-pointer"
                        title="Reject registration"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Master Scrutiny & Approval Workflow */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-[#2E3646]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#4F46E5] dark:text-cyan-300" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Transport Requests &amp; Scrutiny Queue
                </h3>
              </div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300">
                {applications.filter((a) => a.status === 'PENDING' || a.status === 'PENDING_SCRUTINY').length} Pending ({applications.length} Total)
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {applications.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-[#2E3646]">
                  No pending scrutiny applications found. All special transport requests are cleared.
                </p>
              ) : (
                applications.map((app) => (
                  <div
                    key={app.id}
                    className="prismatic-subcard flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-black text-[#4F46E5] dark:text-cyan-300">
                          {app.id}
                        </span>
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {app.studentName} ({app.rollNumber})
                        </span>
                        <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-[#1E2430] dark:text-slate-400">
                          {app.requestType.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">
                        {app.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {app.reason}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {app.status === 'PENDING' || app.status === 'PENDING_SCRUTINY' ? (
                        <>
                          <button
                            type="button"
                            disabled={scrutinyLoadingId === app.id}
                            onClick={() => handleStatusChange(app.id, 'APPROVED')}
                            className="electric-cta rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                          >
                            {scrutinyLoadingId === app.id ? 'Saving...' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={scrutinyLoadingId === app.id}
                            onClick={() => handleStatusChange(app.id, 'REJECTED')}
                            className="tactile-btn rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 disabled:opacity-50 cursor-pointer"
                          >
                            {scrutinyLoadingId === app.id ? 'Saving...' : 'Reject'}
                          </button>
                        </>
                      ) : (
                        <span
                          className={`rounded-xl px-3 py-1 text-xs font-bold ${
                            app.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {app.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {adminTab === 'FLEET' && (
        <div className="animate-panel-in space-y-4">
          {/* Dual Mode Fleet Radar Map */}
          <div className="prismatic-card overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-3.5 dark:border-[#2E3646]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#06B6D4] shadow-[0_0_8px_rgba(6,182,212,0.85)] animate-pulse" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Fleet Radar Overview
                </span>
              </div>

              <div className="prismatic-subcard flex items-center gap-1 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setMapMode('INTERACTIVE')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    mapMode === 'INTERACTIVE'
                      ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
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
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
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
                  showAllFleet={true}
                  heightClass="h-72 w-full"
                />
              ) : (
                <div className="h-72 w-full">
                  <MetroSchematicMap activeBus={activeBus} />
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Route Optimization & Area Attendance Matrix */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-[#2E3646]">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                  <Navigation className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                      Route Optimization &amp; Area Attendance Matrix
                    </h2>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                      {activeRouteId === 'route-51'
                        ? '26 Registered (18 Students • 8 Faculty/Staff)'
                        : `${routeOptimizationPlan?.totalRouteStudents || 0} Registered`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Bypasses area clusters when 100% of registered riders have active absences.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <select
                  value={activeRouteId}
                  onChange={(e) => setActiveRouteId(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                >
                  {buses.map((b) => (
                    <option key={b.routeId} value={b.routeId}>
                      {b.routeNumber} ({b.routeName})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => toggleRoutePlanLock(activeRouteId, !routeOptimizationPlan?.locked)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    routeOptimizationPlan?.locked
                      ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800'
                      : 'electric-cta text-white'
                  }`}
                >
                  {routeOptimizationPlan?.locked ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      <span>Locked (1h Pre-Departure) — Unlock</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3.5 w-3.5" />
                      <span>Open (Lock Overnight Plan)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-[#2E3646] dark:text-slate-400">
                    <th className="pb-2">Area Cluster</th>
                    <th className="pb-2">Stops</th>
                    <th className="pb-2 text-center">Registered</th>
                    <th className="pb-2 text-center">Absent</th>
                    <th className="pb-2 text-center">Coming</th>
                    <th className="pb-2 text-center">Status</th>
                    <th className="pb-2 text-right">Admin Override</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#2E3646]">
                  {(routeOptimizationPlan?.clusters || []).map((cluster: any) => {
                    const isOverridden =
                      Array.isArray(routeOptimizationPlan?.overrideKeepClusters) &&
                      routeOptimizationPlan.overrideKeepClusters.includes(cluster.clusterId);
                    return (
                      <tr key={cluster.clusterId} className="hover:bg-indigo-50/40 dark:hover:bg-white/[0.02]">
                        <td className="py-2.5 font-bold text-slate-900 dark:text-white">
                          {cluster.clusterName}
                        </td>
                        <td className="py-2.5 text-slate-500 dark:text-slate-400">
                          {(cluster.stops || []).map((s: any) => s.shortName || s.name).join(' • ')}
                        </td>
                        <td className="py-2.5 text-center font-mono font-semibold">
                          <div>{cluster.totalRegisteredStudents || cluster.totalStudents}</div>
                          {(cluster.facultyCount > 0 || cluster.studentCount > 0) && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {cluster.studentCount || 0}S • {cluster.facultyCount || 0}F
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                          {cluster.absentStudents}
                        </td>
                        <td className="py-2.5 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {cluster.comingStudents}
                        </td>
                        <td className="py-2.5 text-center">
                          {cluster.isCampus ? (
                            <span className="rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 text-[10px] font-bold">
                              CAMPUS HUB
                            </span>
                          ) : cluster.isSkipped ? (
                            <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                              BYPASS (0 Riders)
                            </span>
                          ) : isOverridden ? (
                            <span className="rounded-full bg-indigo-100 text-[#4F46E5] dark:bg-indigo-950 dark:text-indigo-300 px-2 py-0.5 text-[10px] font-bold">
                              FORCE KEPT
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 text-[10px] font-bold">
                              ACTIVE STOP
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          {!cluster.isCampus && (
                            <button
                              type="button"
                              onClick={() => setClusterOptimizationOverride(activeRouteId, cluster.clusterId, !isOverridden)}
                              className={`tactile-btn rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                                isOverridden
                                  ? 'bg-indigo-100 text-[#4F46E5] hover:bg-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300'
                                  : 'border border-slate-200 bg-[#F7F9FF] text-slate-800 hover:bg-white dark:border-[#2E3646] dark:bg-[#141821] dark:text-white'
                              }`}
                            >
                              {isOverridden ? 'Clear Keep Override' : 'Force Keep Stop'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Incident Queue */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-[#2E3646]">
              <div className="flex items-center gap-2">
                <AlertTriangle className={`h-5 w-5 ${activeIncidentsCount > 0 ? 'text-rose-500 animate-bounce' : 'text-slate-400'}`} />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Live Incident Queue ({activeIncidentsCount} Open)
                </h2>
              </div>
              <button
                type="button"
                onClick={reloadData}
                className="text-xs font-bold text-[#4F46E5] hover:underline dark:text-cyan-300 cursor-pointer"
              >
                Refresh Feed
              </button>
            </div>

            <div className="mt-3.5 space-y-2.5">
              {incidents.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic p-2">
                  No incidents reported today. All routes operating under normal conditions.
                </p>
              ) : (
                incidents.slice(0, 5).map((inc) => (
                  <div
                    key={inc.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 ${
                      inc.open
                        ? 'border-rose-300 bg-rose-50/70 dark:bg-rose-950/30'
                        : 'prismatic-subcard opacity-60'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${
                            inc.kind === 'SOS' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
                          }`}
                        >
                          {inc.kind}
                        </span>
                        <span className="font-extrabold text-xs text-slate-900 dark:text-white">
                          {inc.route_id} • Reported by {inc.who}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {new Date(inc.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{inc.msg}</p>
                    </div>

                    {inc.open ? (
                      <button
                        type="button"
                        onClick={() => handleResolveIncident(inc.id)}
                        className="tactile-btn flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-700 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Mark Resolved</span>
                      </button>
                    ) : (
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">✓ Resolved</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Announcements Composer */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-[#2E3646]">
              <Bell className="h-5 w-5 text-[#4F46E5] dark:text-cyan-300" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Campus Route Announcements Composer
              </h2>
            </div>

            <form onSubmit={handlePostAnnouncement} className="mt-3.5 space-y-3">
              <div className="flex flex-wrap gap-2">
                <select
                  value={newAnnouncementRoute}
                  onChange={(e) => setNewAnnouncementRoute(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs font-bold text-slate-900 dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                >
                  <option value="ALL">Broadcast to All Routes</option>
                  {buses.map((b) => (
                    <option key={b.routeId} value={b.routeId}>
                      {b.routeNumber} ({b.routeName.split('—')[0].trim()})
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={newAnnouncementText}
                  onChange={(e) => setNewAnnouncementText(e.target.value)}
                  placeholder="e.g. Warangal Highway heavy rain advisory: Bus arriving with 10m caution."
                  className="flex-1 min-w-[240px] rounded-xl border border-slate-200 bg-[#F7F9FF] px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                  maxLength={280}
                  required
                />

                <button
                  type="submit"
                  disabled={isPostingAnnouncement || !newAnnouncementText.trim()}
                  className="electric-cta flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isPostingAnnouncement ? 'Broadcasting...' : 'Publish'}</span>
                </button>
              </div>
            </form>

            {announcements.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-[#2E3646]">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Active Notices on Passenger Feeds:
                </p>
                {announcements.slice(0, 4).map((ann) => (
                  <div
                    key={ann.id}
                    className="prismatic-subcard flex items-center justify-between rounded-xl p-2.5 text-xs"
                  >
                    <div>
                      <span className="font-bold text-[#4F46E5] dark:text-cyan-300">[{ann.route_id}]:</span>{' '}
                      <span className="text-slate-900 dark:text-white">{ann.msg}</span>
                      <span className="ml-2 text-[10px] text-slate-500 dark:text-slate-400">
                        {new Date(ann.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteAnnouncement(ann.id)}
                      className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      title="Delete Announcement"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {adminTab === 'LOGS' && (
        <div className="animate-panel-in space-y-4">
          {/* Live Server Health Strip */}
          <div className="prismatic-card rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                  <Activity className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                    Live Server Health &amp; Diagnostics
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Real-time SSE streams, SQLite WAL storage, and backups.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="prismatic-subcard flex items-center gap-1.5 rounded-xl px-2.5 py-1">
                  <Radio className="h-3.5 w-3.5 text-[#06B6D4] animate-pulse" />
                  <span className="text-slate-500 dark:text-slate-400">SSE:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{serverHealth?.activeSseClients ?? 0}</span>
                </div>

                <div className="prismatic-subcard flex items-center gap-1.5 rounded-xl px-2.5 py-1">
                  <span className="text-slate-500 dark:text-slate-400">Routes:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{serverHealth?.liveRoutes ?? 0} live</span>
                  {serverHealth?.staleRoutes && serverHealth.staleRoutes.length > 0 && (
                    <span className="font-bold text-amber-600 dark:text-amber-400">({serverHealth.staleRoutes.length} stale)</span>
                  )}
                </div>

                <div className="prismatic-subcard flex items-center gap-1.5 rounded-xl px-2.5 py-1">
                  <HardDrive className="h-3.5 w-3.5 text-[#4F46E5]" />
                  <span className="text-slate-500 dark:text-slate-400">WAL:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {serverHealth ? (serverHealth.walBytes < 1024 ? `${serverHealth.walBytes} B` : `${(serverHealth.walBytes / 1024).toFixed(1)} KB`) : '0 B'}
                  </span>
                </div>

                <div className="prismatic-subcard flex items-center gap-1.5 rounded-xl px-2.5 py-1">
                  <span className="text-slate-500 dark:text-slate-400">Last Backup:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {serverHealth?.lastBackupAt ? new Date(serverHealth.lastBackupAt).toLocaleTimeString() : 'None'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={isBackupLoading}
                  className="electric-cta flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>{isBackupLoading ? 'Backing Up...' : 'SQLite WAL Backup'}</span>
                </button>

                <button
                  type="button"
                  onClick={fetchHealth}
                  disabled={isHealthRefreshing}
                  title="Refresh Server Health"
                  className="tactile-btn rounded-xl border border-slate-200 bg-[#F7F9FF] p-1.5 text-slate-700 hover:bg-indigo-50 dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200 cursor-pointer"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isHealthRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Bulk Onboard Roster (.xlsx) & SQLite WAL Backup */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-[#2E3646]">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                  <Upload className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                    Bulk Onboard Roster (.xlsx) &amp; System Backup
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Onboard up to 500 riders via .xlsx/.csv with activation PINs and SQLite WAL backups.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleBulkFileChange}
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImportingRoster}
                  className="electric-cta flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{isImportingRoster ? 'Parsing Sheet...' : 'Bulk Onboard Roster (.xlsx)'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={isBackupLoading}
                  className="tactile-btn flex items-center gap-1.5 rounded-xl border border-slate-200 bg-[#F7F9FF] px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-indigo-50 dark:border-[#2E3646] dark:bg-[#141821] dark:text-white cursor-pointer"
                >
                  <Database className="h-3.5 w-3.5 text-[#4F46E5]" />
                  <span>{isBackupLoading ? 'Backing Up...' : 'Create SQLite WAL Backup'}</span>
                </button>
              </div>
            </div>

            {bulkImportResult && (
              <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <h4 className="text-xs font-extrabold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                      <Key className="h-4 w-4 text-[#4F46E5] dark:text-cyan-300" />
                      <span>One-Time Rider Activation PINs ({bulkImportResult.createdCount} Accounts Created)</span>
                    </h4>
                    <p className="text-[11px] text-indigo-700 dark:text-indigo-300 mt-0.5">
                      {bulkImportResult.skippedExistingCount} existing preserved • {bulkImportResult.errors?.length || 0} errors skipped.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadPinsCsv}
                      className="electric-cta flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download Onboarding PINs (CSV)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkImportResult(null)}
                      className="tactile-btn rounded-xl border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-bold text-[#4F46E5] hover:bg-indigo-50 dark:border-indigo-800 dark:bg-[#1E2430] dark:text-indigo-300 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>

                {bulkImportResult.credentials && bulkImportResult.credentials.length > 0 && (
                  <div className="overflow-x-auto max-h-64 rounded-xl border border-indigo-200 bg-white dark:border-indigo-900 dark:bg-[#141821]">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-[#F7F9FF] dark:bg-[#1E2430] text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#2E3646]">
                        <tr>
                          <th className="px-3 py-2">Roll Number</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Route</th>
                          <th className="px-3 py-2">Stop</th>
                          <th className="px-3 py-2">Role</th>
                          <th className="px-3 py-2">Activation PIN</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-[#2E3646] font-medium">
                        {bulkImportResult.credentials.map((c, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-1.5 font-mono font-bold text-slate-900 dark:text-white">{c.rollNumber}</td>
                            <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{c.name}</td>
                            <td className="px-3 py-1.5 uppercase text-slate-500 dark:text-slate-400">{c.routeId}</td>
                            <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{c.pickupStop}</td>
                            <td className="px-3 py-1.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  c.riderType === 'FACULTY'
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                    : 'bg-indigo-100 text-[#4F46E5] dark:bg-indigo-950 dark:text-indigo-300'
                                }`}
                              >
                                {c.riderType}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              <span className="font-mono font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950 dark:border-emerald-800">
                                {c.temporaryPassword}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 1-Click CSV Export Bar */}
          <div className="prismatic-card rounded-3xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Download className="h-4 w-4 text-[#4F46E5] dark:text-cyan-300" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                1-Click Administrative CSV Data Exports
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDownloadCsv('incidents')}
                className="tactile-btn rounded-xl border border-slate-200/80 bg-[#F7F9FF] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200 cursor-pointer"
              >
                Export Incidents (CSV)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCsv('feedback')}
                className="tactile-btn rounded-xl border border-slate-200/80 bg-[#F7F9FF] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200 cursor-pointer"
              >
                Export Feedback (CSV)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCsv('absences')}
                className="tactile-btn rounded-xl border border-slate-200/80 bg-[#F7F9FF] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200 cursor-pointer"
              >
                Export Absences (CSV)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCsv('lost')}
                className="tactile-btn rounded-xl border border-slate-200/80 bg-[#F7F9FF] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200 cursor-pointer"
              >
                Export Lost &amp; Found (CSV)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCsv('boardings')}
                className="tactile-btn rounded-xl border border-slate-200/80 bg-[#F7F9FF] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200 cursor-pointer"
              >
                Export Boarding Roster (CSV)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCsv('driver_utility')}
                className="electric-cta rounded-xl px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
              >
                Export Driver Utility CSV
              </button>
            </div>
          </div>

          {/* Lost & Found Desk & Student Ride Feedback Dual Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="prismatic-card rounded-3xl p-5">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-[#2E3646]">
                <PackageSearch className="h-5 w-5 text-[#4F46E5] dark:text-cyan-300" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Campus Lost &amp; Found Desk
                </h3>
              </div>
              <div className="mt-3.5 space-y-2.5 max-h-56 overflow-y-auto">
                {lostItems.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic p-2">
                    No items reported missing today.
                  </p>
                ) : (
                  lostItems.map((item) => (
                    <div
                      key={item.id}
                      className="prismatic-subcard flex items-center justify-between rounded-xl p-2.5 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{item.msg}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Reported by {item.who} • {new Date(item.ts).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                      {item.open ? (
                        <button
                          type="button"
                          onClick={() => handleResolveLost(item.id)}
                          className="tactile-btn rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 cursor-pointer"
                        >
                          Returned
                        </button>
                      ) : (
                        <span className="text-[11px] font-bold text-emerald-600">✓ Returned</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="prismatic-card rounded-3xl p-5">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-[#2E3646]">
                <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Student Ride Feedback
                </h3>
              </div>
              <div className="mt-3.5 space-y-2.5 max-h-56 overflow-y-auto">
                {feedbackList.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic p-2">
                    No ride ratings submitted yet today.
                  </p>
                ) : (
                  feedbackList.slice(0, 6).map((fb) => (
                    <div
                      key={fb.id}
                      className="prismatic-subcard rounded-xl p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {fb.student_name} ({fb.roll_number})
                        </span>
                        <span className="font-mono text-amber-500 font-bold">
                          {'★'.repeat(fb.rating)} ({fb.rating}/5)
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                        &quot;{fb.msg}&quot;
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
