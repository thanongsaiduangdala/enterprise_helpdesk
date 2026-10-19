import { fmtDateTime } from './room-invites.pdf';

// ສະຫຼຸບ "ເກີດຫຍັງຂຶ້ນແດ່ໃນການປະຊຸມນີ້" — ໃຊ້ຮ່ວມກັນທັງລາຍງານ CSV ແລະ PDF
// (ເວລາຈັດປະຊຸມ, ຈຳນວນຄົນມາ/ບໍ່ມາ, ເວລາມາຮອດ, ໄລຍະເວລາຈິງ, ການຕໍ່ເວລາ, ເວລາສິ້ນສຸດ ແລະ timeline ທັງໝົດ)

export interface SummaryItem {
  label: string;
  value: string;
}

export interface SummarySection {
  title: string;
  items: SummaryItem[];
}

export interface TimelineEntry {
  at: string;
  event: string;
  detail: string;
}

export interface MeetingSummary {
  sections: SummarySection[];
  timeline: TimelineEntry[];
}

export interface SummaryAttendanceRow {
  status: string; // JOINED | NOT_JOINED | DENIED
  at?: Date | null; // ເວລາມາຮອດຈິງ (ສຳລັບ JOINED)
}

export interface SummaryInput {
  bookingId: string;
  title: string;
  roomName: string;
  roomCapacity?: number;
  bookedByName: string;
  inviteMode?: string;
  startAt: Date;
  endAt: Date;
  checkedInAt?: Date | null;
  checkedOutAt?: Date | null;
  history: {
    action: string;
    at?: Date;
    fromStartAt?: Date;
    fromEndAt?: Date;
    toStartAt?: Date;
    toEndAt?: Date;
    note?: string;
  }[];
  invited: number;
  rows: SummaryAttendanceRow[];
  now?: Date;
}

// ຜູ້ເຂົ້າຮ່ວມທີ່ມາຊ້າກວ່າເວລານັດເກີນຈຳນວນນາທີນີ້ ນັບວ່າ "ມາຊ້າ"
const LATE_GRACE_MINUTES = 5;

const minutesBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 60000);

export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

// ປຽບທຽບເວລາມາຮອດກັບເວລານັດ → "on time" / "7 min late" / "3 min early"
export function arrivalText(at: Date | null | undefined, start: Date): string {
  if (!at) return '';
  const diff = minutesBetween(start, at);
  if (diff > LATE_GRACE_MINUTES) return `${fmtDuration(diff)} late`;
  if (diff < -1) return `${fmtDuration(-diff)} early`;
  return 'on time';
}

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Booking created',
  APPROVED: 'Booking approved',
  REJECTED: 'Booking rejected',
  RESCHEDULE_REQUESTED: 'Time change requested',
  REQUEST_UPDATED: 'Request edited',
  RESCHEDULE_APPROVED: 'Time change approved',
  RESCHEDULE_REJECTED: 'Time change rejected',
  CANCELLED: 'Booking cancelled',
  NO_SHOW: 'Auto-cancelled (no check-in)',
  CHECKED_IN: 'Host checked in',
  CHECKED_OUT: 'Host checked out',
};

const rangeText = (from?: Date, to?: Date) =>
  from && to ? `${fmtDateTime(from)} → ${fmtDateTime(to)}` : '';

export function buildMeetingSummary(i: SummaryInput): MeetingSummary {
  const now = i.now ?? new Date();
  const history = [...(i.history ?? [])].sort(
    (a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime(),
  );

  // ---------- ເວລາຈັດປະຊຸມ ----------
  const created = history.find((h) => h.action === 'CREATED');
  const originalStart = created?.toStartAt ?? i.startAt;
  const originalEnd = created?.toEndAt ?? i.endAt;
  const wasRescheduled =
    new Date(originalStart).getTime() !== new Date(i.startAt).getTime() ||
    new Date(originalEnd).getTime() !== new Date(i.endAt).getTime();
  const scheduledMinutes = minutesBetween(i.startAt, i.endAt);

  // ---------- ການຕໍ່ເວລາ ----------
  const isExtension = (h: { fromEndAt?: Date; toEndAt?: Date }) =>
    !!h.fromEndAt &&
    !!h.toEndAt &&
    new Date(h.toEndAt).getTime() > new Date(h.fromEndAt).getTime();
  const extensionRequests = history.filter(
    (h) => h.action === 'RESCHEDULE_REQUESTED' && isExtension(h),
  );
  const extensionsApproved = history.filter(
    (h) => h.action === 'RESCHEDULE_APPROVED' && isExtension(h),
  );
  const extraMinutes = extensionsApproved.reduce(
    (sum, h) => sum + minutesBetween(h.fromEndAt!, h.toEndAt!),
    0,
  );
  const extensionsRejected = history.filter(
    (h) => h.action === 'RESCHEDULE_REJECTED',
  ).length;

  // ---------- ເວລາທີ່ໃຊ້ຫ້ອງຈິງ ----------
  const checkedIn = i.checkedInAt ? new Date(i.checkedInAt) : null;
  const checkedOut = i.checkedOutAt ? new Date(i.checkedOutAt) : null;
  const ended = checkedOut ? checkedOut : i.endAt.getTime() <= now.getTime() ? i.endAt : null;
  const actualMinutes =
    checkedIn && ended ? Math.max(0, minutesBetween(checkedIn, ended)) : null;

  let endState = 'Not finished yet';
  if (checkedOut) {
    const diff = minutesBetween(checkedOut, i.endAt);
    if (diff > 1) endState = `Checked out ${fmtDuration(diff)} early`;
    else if (diff < -1) endState = `Checked out ${fmtDuration(-diff)} after scheduled end`;
    else endState = 'Checked out on time';
  } else if (i.endAt.getTime() <= now.getTime()) {
    endState = checkedIn
      ? 'Ran to the scheduled end (no check-out)'
      : 'Ended — nobody checked in';
  } else if (checkedIn) {
    endState = 'In progress';
  }

  let checkInState = 'Did not check in';
  if (checkedIn) {
    const diff = minutesBetween(i.startAt, checkedIn);
    checkInState =
      diff > LATE_GRACE_MINUTES
        ? `${fmtDateTime(checkedIn)} (${fmtDuration(diff)} late)`
        : diff < -1
          ? `${fmtDateTime(checkedIn)} (${fmtDuration(-diff)} early)`
          : `${fmtDateTime(checkedIn)} (on time)`;
  }

  // ---------- ຄົນມາ / ບໍ່ມາ ----------
  const joined = i.rows.filter((r) => r.status === 'JOINED');
  const notJoined = i.rows.filter((r) => r.status === 'NOT_JOINED').length;
  const denied = i.rows.filter((r) => r.status === 'DENIED').length;
  const arrivals = joined
    .map((r) => (r.at ? new Date(r.at) : null))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  const lateCount = arrivals.filter(
    (d) => minutesBetween(i.startAt, d) > LATE_GRACE_MINUTES,
  ).length;
  const isPrivate = i.inviteMode === 'PRIVATE' || i.invited > 0;

  const attendanceItems: SummaryItem[] = [];
  if (isPrivate) {
    attendanceItems.push({ label: 'Invited', value: String(i.invited) });
  }
  attendanceItems.push({ label: 'Came (joined)', value: String(joined.length) });
  if (isPrivate) {
    attendanceItems.push({ label: 'Did not come', value: String(notJoined) });
    if (i.invited > 0) {
      attendanceItems.push({
        label: 'Attendance rate',
        value: `${Math.round((joined.length / i.invited) * 100)}%`,
      });
    }
  }
  attendanceItems.push({ label: 'Denied entry attempts', value: String(denied) });
  if (arrivals.length) {
    attendanceItems.push({
      label: 'First arrival',
      value: `${fmtDateTime(arrivals[0])} (${arrivalText(arrivals[0], i.startAt)})`,
    });
    attendanceItems.push({
      label: 'Last arrival',
      value: `${fmtDateTime(arrivals[arrivals.length - 1])} (${arrivalText(
        arrivals[arrivals.length - 1],
        i.startAt,
      )})`,
    });
    attendanceItems.push({
      label: 'Arrived late',
      value: `${lateCount} of ${arrivals.length} (more than ${LATE_GRACE_MINUTES} min after start)`,
    });
  }
  if (i.roomCapacity) {
    attendanceItems.push({
      label: 'Room capacity used',
      value: `${joined.length} of ${i.roomCapacity} seats (${Math.round(
        (joined.length / i.roomCapacity) * 100,
      )}%)`,
    });
  }

  // ---------- ປະກອບເປັນສ່ວນໆ ----------
  const meeting: SummaryItem[] = [
    { label: 'Title', value: i.title },
    { label: 'Booking ID', value: i.bookingId },
    {
      label: 'Room',
      value: i.roomCapacity
        ? `${i.roomName} (capacity ${i.roomCapacity})`
        : i.roomName,
    },
    { label: 'Booked by', value: i.bookedByName },
    { label: 'Invite mode', value: i.inviteMode ?? 'Not opened' },
  ];

  const timing: SummaryItem[] = [
    { label: 'Meeting date', value: fmtDateTime(i.startAt).slice(0, 11) },
    { label: 'Scheduled time', value: rangeText(i.startAt, i.endAt) },
    { label: 'Scheduled length', value: fmtDuration(scheduledMinutes) },
  ];
  if (wasRescheduled) {
    timing.push({
      label: 'Originally booked for',
      value: rangeText(originalStart, originalEnd),
    });
  }
  timing.push(
    { label: 'Host check-in', value: checkInState },
    {
      label: 'Host check-out',
      value: checkedOut ? fmtDateTime(checkedOut) : 'No check-out recorded',
    },
    {
      label: 'Actual meeting length',
      value: actualMinutes === null ? 'Unknown' : fmtDuration(actualMinutes),
    },
  );
  if (actualMinutes !== null && scheduledMinutes > 0) {
    timing.push({
      label: 'Room time used',
      value: `${Math.round((actualMinutes / scheduledMinutes) * 100)}% of the booked time`,
    });
  }
  timing.push({ label: 'How it ended', value: endState });

  const extension: SummaryItem[] = [
    {
      label: 'Time extended?',
      value: extensionsApproved.length ? 'Yes' : 'No',
    },
    {
      label: 'Extension requests',
      value: `${extensionRequests.length} (approved ${extensionsApproved.length}, rejected ${extensionsRejected})`,
    },
  ];
  if (extensionsApproved.length) {
    extension.push(
      { label: 'Extra time granted', value: fmtDuration(extraMinutes) },
      { label: 'Final scheduled end', value: fmtDateTime(i.endAt) },
    );
  }

  // ---------- timeline ----------
  const timeline: TimelineEntry[] = history.map((h) => {
    let detail = '';
    if (h.fromEndAt && h.toEndAt && h.action.startsWith('RESCHEDULE')) {
      detail = `Was ${rangeText(h.fromStartAt, h.fromEndAt)}; now ${rangeText(h.toStartAt, h.toEndAt)}`;
    } else if (h.action === 'CREATED') {
      detail = rangeText(h.toStartAt, h.toEndAt);
    }
    if (h.note) detail = detail ? `${detail} — ${h.note}` : h.note;
    return {
      at: fmtDateTime(h.at),
      event: ACTION_LABEL[h.action] ?? h.action,
      detail,
    };
  });

  return {
    sections: [
      { title: 'Meeting', items: meeting },
      { title: 'Time & duration', items: timing },
      { title: 'Time extension', items: extension },
      { title: 'Attendance', items: attendanceItems },
    ],
    timeline,
  };
}
