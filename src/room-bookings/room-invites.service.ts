import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { createSocket } from 'dgram';
import { networkInterfaces } from 'os';
import { Model, Types } from 'mongoose';
import {
    BookingCheckIn,
    BookingInvitee,
    BookingStatus,
    InviteMode,
    RoomBooking,
    RoomBookingDocument,
} from './schemas/room-booking.schema';
import { AddInviteeDto, JoinDto, SetInviteModeDto } from './dto/invite.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { RoomsService } from '../rooms/rooms.service';
import { RoomBookingsGateway } from './room-bookings.gateway';
import { hasAnyPermission, PermissionUser } from '../common/utils/permission.util';
import { toCsv } from '../reports/csv.util';
import { AttendanceRow, buildAttendancePdf, buildQrPdf, fmtDateTime, QrPageInput } from './room-invites.pdf';

const EARLY_JOIN_MINUTES = 30;
const MAX_INVITEES = 300;
const MAX_DENIED_LOGS = 200;
const HARD_MAX_ADMITTED = 500;

export type JoinReason =
    | 'INVALID_QR'
    | 'BOOKING_NOT_ACTIVE'
    | 'INVITES_CLOSED'
    | 'TOO_EARLY'
    | 'ENDED'
    | 'NOT_ON_LIST'
    | 'REVOKED'
    | 'ROOM_FULL'
    | 'ACCOUNT_MISMATCH'
    | 'ACCOUNT_INACTIVE';

const REASON_TEXT: Record<JoinReason, string> = {
    INVALID_QR: 'This QR code is not valid.',
    BOOKING_NOT_ACTIVE: 'This booking is cancelled or not confirmed.',
    INVITES_CLOSED: 'The host has closed invitations for this meeting.',
    TOO_EARLY: 'The meeting has not opened for check-in yet.',
    ENDED: 'This meeting has ended.',
    NOT_ON_LIST: 'You are not on the guest list.',
    REVOKED: 'Your invitation was removed by the host.',
    ROOM_FULL: 'The room is full.',
    ACCOUNT_MISMATCH: 'This pass belongs to a different account.',
    ACCOUNT_INACTIVE: 'This account is deactivated.',
};

export interface JoinBookingInfo {
    title: string;
    roomName: string;
    startAt: Date;
    endAt: Date;
}

type Via = 'DOOR_QR' | 'PERSONAL_QR';
type HostUser = PermissionUser & { userId: string };

type Who = { name: string; contact: string; userId?: string; employeeCode?: string };

const newToken = () => randomBytes(18).toString('base64url');

const cleanName = (v?: string) =>
    (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

const normContact = (v?: string) => (v ?? '').trim().toLowerCase().replace(/[\s\-()]/g, '');
const normName = (v?: string) => cleanName(v).toLowerCase();

const isLocalHost = (h: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);
const isPrivateIp = (h: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);

const isLocalOrLanOrigin = (origin: string) => {
    try {
        const u = new URL(origin);
        return (u.protocol === 'http:' || u.protocol === 'https:') && (isLocalHost(u.hostname) || isPrivateIp(u.hostname));
    } catch {
        return false;
    }
};

const allLanIps = (): string[] => {
    const found: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
        for (const n of list ?? []) {
            if (n.family === 'IPv4' && !n.internal && isPrivateIp(n.address)) found.push(n.address);
        }
    }
    return found;
};

// IP ຂອງ network ທີ່ເຄື່ອງນີ້ໃຊ້ອອກຈິງ (interface ທີ່ມີ default route) — ໃຊ້ UDP connect ທີ່ບໍ່ສົ່ງ packet ແທ້.
// ເຄື່ອງທີ່ມີຫຼາຍ IP (Wi-Fi + LAN, VPN, DHCP ປ່ຽນ) ຈະໄດ້ IP ດຽວກັນສະເໝີ ແທນທີ່ຈະ "ເລືອກໂຕທຳອິດທີ່ເຈິ" ທີ່ສະຫຼັບໄປມາ.
const activeLanIp = (): Promise<string | null> =>
    new Promise((resolve) => {
        const socket = createSocket('udp4');
        let finished = false;
        const done = (ip: string | null) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { socket.close(); } catch { /* ignore */ }
            resolve(ip);
        };
        const timer = setTimeout(() => done(null), 500);
        socket.once('error', () => done(null));
        try {
            socket.connect(53, '8.8.8.8', () => {
                try {
                    const ip = socket.address().address;
                    done(isPrivateIp(ip) ? ip : null);
                } catch {
                    done(null);
                }
            });
        } catch {
            done(null);
        }
    });

const currentLanIp = async (): Promise<string | null> => {
    const active = await activeLanIp();
    if (active) return active;
    // ບໍ່ມີ default route (LAN ປິດ) → ເລືອກແບບຄົງທີ່: 192.168.x ກ່ອນ, ແລ້ວ 10.x, ແລ້ວ 172.16-31, ລຽງຕາມຕົວເລກ
    const found = allLanIps().sort();
    return found.find((a) => a.startsWith('192.168.')) ?? found.find((a) => a.startsWith('10.')) ?? found[0] ?? null;
};

// QR ຕ້ອງຕາມ URL ທີ່ເປີດ frontend ຢູ່ (ເຊັ່ນ ເປີດທີ່ 10.4.9.88:5173 → QR ກໍເປັນ 10.4.9.88:5173).
// ປ່ຽນສະເພາະ localhost/127.0.0.1 (ມືຖືເຂົ້າບໍ່ໄດ້) ໃຫ້ເປັນ IP ປັດຈຸບັນຂອງເຄື່ອງ server — IP ວົງ LAN ອື່ນ ແລະ port ຮັກສາໄວ້ຕາມເດີມ.
const toReachable = async (base: string) => {
    try {
        const u = new URL(base);
        if (isLocalHost(u.hostname)) {
            const ip = await currentLanIp();
            if (ip) u.hostname = ip;
        }
        return u.toString().replace(/\/+$/, '');
    } catch {
        return base;
    }
};

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const accountName = (u: { firstName: string; lastName: string }) => cleanName(`${u.firstName} ${u.lastName}`);

const sameGuest = (c: BookingCheckIn, w: Who) =>
    w.userId
        ? c.userId === w.userId
        : !c.userId && normName(c.name) === normName(w.name) && normContact(c.contact) === normContact(w.contact);

const safeCell = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

@Injectable()
export class RoomInvitesService {
    constructor(
        @InjectModel(RoomBooking.name) private bookingModel: Model<RoomBookingDocument>,
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        @Inject(forwardRef(() => RoomsService)) private roomsService: RoomsService,
        private gateway: RoomBookingsGateway,
    ) { }

    private async load(id: string) {
        const booking = await this.bookingModel
            .findOne({ $expr: { $eq: [{ $toString: '$_id' }, id] } })
            .select('+inviteToken +invitees +checkIns')
            .exec();
        if (!booking) throw new NotFoundException('Booking not found');
        if (!Array.isArray(booking.invitees)) booking.invitees = [];
        if (!Array.isArray(booking.checkIns)) booking.checkIns = [];
        return booking;
    }

    private assertHost(booking: RoomBookingDocument, user: HostUser) {
        const isOwner = booking.bookedBy.toString() === user.userId;
        const elevated = hasAnyPermission(user, 'rooms', ['manage', 'approve']);
        if (!isOwner && !elevated) {
            throw new ForbiddenException('Only the person who booked this room can manage its invitations');
        }
    }

    private async roomInfo(roomId: string): Promise<{ name: string; capacity?: number }> {
        try {
            const room: any = await this.roomsService.findOne(roomId);
            return { name: room?.name || roomId, capacity: room?.capacity };
        } catch {
            return { name: roomId };
        }
    }

    private async bookingInfo(booking: RoomBookingDocument): Promise<JoinBookingInfo & { capacity?: number }> {
        const room = await this.roomInfo(String(booking.roomId));
        return { title: booking.title, roomName: room.name, startAt: booking.startAt, endAt: booking.endAt, capacity: room.capacity };
    }

    private async appBaseUrl(requested?: string): Promise<string> {
        const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
        if (configured) return configured;
        const allowed = (process.env.FRONTEND_URLS || 'http://localhost:5173')
            .split(',')
            .map((s) => s.trim().replace(/\/+$/, ''))
            .filter(Boolean);
        const wanted = requested?.trim().replace(/\/+$/, '');
        const base = wanted && (allowed.includes(wanted) || isLocalOrLanOrigin(wanted)) ? wanted : allowed[0];
        return toReachable(base);
    }

    private joinUrl(token: string, appBase: string) {
        return `${appBase}/join/${token}`;
    }

    private async loadAccount(userId?: string) {
        if (!userId || !Types.ObjectId.isValid(userId)) return null;
        const u = await this.userModel.findById(userId).exec();
        if (!u) return null;
        return {
            userId: String(u._id),
            employeeCode: u.employeeCode,
            name: accountName(u),
            email: u.email || undefined,
            phone: u.phone || undefined,
            isActive: u.isActive,
        };
    }

    private async findAccount(dto: AddInviteeDto) {
        let u: UserDocument | null = null;
        if (dto.userId) {
            if (!Types.ObjectId.isValid(dto.userId)) throw new BadRequestException('Invalid account');
            u = await this.userModel.findById(dto.userId).exec();
        } else if (dto.accountId) {
            u = await this.userModel
                .findOne({ employeeCode: new RegExp(`^${escapeRegex(dto.accountId.trim())}$`, 'i') })
                .exec();
        }
        if (!u) throw new NotFoundException('Account not found');
        if (!u.isActive) throw new BadRequestException('This account is deactivated');
        return u;
    }

    async searchAccounts(id: string, user: HostUser, q?: string) {
        const b = await this.load(id);
        this.assertHost(b, user);
        const term = (q ?? '').trim().slice(0, 60);
        if (term.length < 2) return [];
        const tokens = term.split(/\s+/).slice(0, 4);
        const found = await this.userModel
            .find({
                isActive: true,
                $and: tokens.map((t) => {
                    const rx = new RegExp(escapeRegex(t), 'i');
                    return { $or: [{ employeeCode: rx }, { firstName: rx }, { lastName: rx }] };
                }),
            })
            .select('employeeCode firstName lastName')
            .sort({ firstName: 1 })
            .limit(8)
            .exec();
        const invited = new Set(b.invitees.filter((i) => !i.revokedAt && i.userId).map((i) => i.userId));
        return found.map((u) => ({
            userId: String(u._id),
            employeeCode: u.employeeCode,
            name: accountName(u),
            alreadyInvited: invited.has(String(u._id)),
        }));
    }

    async getInvite(id: string, user: HostUser) {
        const b = await this.load(id);
        this.assertHost(b, user);

        const active = b.invitees.filter((i) => !i.revokedAt);
        const admitted = b.checkIns.filter((c) => c.result === 'ADMITTED');
        const denied = b.checkIns.filter((c) => c.result === 'DENIED');

        return {
            bookingId: b._id,
            title: b.title,
            status: b.status,
            startAt: b.startAt,
            endAt: b.endAt,
            inviteMode: b.inviteMode ?? null,
            invitees: active.map((i) => ({
                _id: String(i._id),
                name: i.name,
                email: i.email ?? null,
                phone: i.phone ?? null,
                employeeCode: i.employeeCode ?? null,
                isAccount: !!i.userId,
                addedAt: i.addedAt,
                joinedAt: i.joinedAt ?? null,
            })),
            stats: {
                invited: active.length,
                joined: admitted.length,
                notJoined: active.filter((i) => !i.joinedAt).length,
                denied: denied.length,
            },
            recentScans: [...b.checkIns].reverse().slice(0, 50).map((c) => ({
                name: c.name,
                contact: c.contact ?? null,
                employeeCode: c.employeeCode ?? null,
                result: c.result,
                reason: c.reason ?? null,
                via: c.via,
                at: c.at,
            })),
        };
    }

    async setMode(id: string, user: HostUser, dto: SetInviteModeDto) {
        const b = await this.load(id);
        this.assertHost(b, user);

        if (dto.mode === 'NONE') {
            await this.bookingModel.updateOne({ _id: b._id }, { $unset: { inviteMode: 1 } });
        } else {
            if (b.status !== BookingStatus.CONFIRMED) {
                throw new BadRequestException('Invitations can only be opened on a confirmed booking');
            }
            if (b.endAt.getTime() <= Date.now()) {
                throw new BadRequestException('This booking has already ended');
            }
            const $set: Record<string, any> = { inviteMode: dto.mode };
            if (!b.inviteToken) $set.inviteToken = newToken();
            await this.bookingModel.updateOne({ _id: b._id }, { $set });
        }
        this.gateway.emitBookingsChanged(String(b.roomId));
        return this.getInvite(id, user);
    }

    async addInvitee(id: string, user: HostUser, dto: AddInviteeDto) {
        const b = await this.load(id);
        this.assertHost(b, user);
        if (b.inviteMode !== InviteMode.PRIVATE) {
            throw new BadRequestException('Switch the booking to PRIVATE to build a guest list');
        }
        if (b.endAt.getTime() <= Date.now()) throw new BadRequestException('This booking has already ended');

        const account = dto.userId || dto.accountId ? await this.findAccount(dto) : null;
        const name = account ? accountName(account) : cleanName(dto.name);
        if (!name) throw new BadRequestException('Name is required');
        const email = account ? account.email || undefined : dto.email?.trim().toLowerCase() || undefined;
        const phone = account ? account.phone || undefined : dto.phone?.trim() || undefined;
        const userId = account ? String(account._id) : undefined;
        const employeeCode = account?.employeeCode;

        const active = b.invitees.filter((i) => !i.revokedAt);
        if (active.length >= MAX_INVITEES) throw new BadRequestException(`Guest list is limited to ${MAX_INVITEES} people`);
        const dup = active.find(
            (i) =>
                (userId && i.userId === userId) ||
                (email && i.email === email) ||
                (phone && i.phone && normContact(i.phone) === normContact(phone)) ||
                (!email && !phone && !i.email && !i.phone && normName(i.name) === normName(name)),
        );
        if (dup) throw new ConflictException(`"${dup.name}" is already on the guest list`);

        const invitee = { _id: new Types.ObjectId(), name, email, phone, userId, employeeCode, token: newToken(), addedAt: new Date() };
        await this.bookingModel.updateOne({ _id: b._id }, { $push: { invitees: invitee } });
        return { _id: String(invitee._id), name, email: email ?? null, phone: phone ?? null, employeeCode: employeeCode ?? null };
    }

    async removeInvitee(id: string, user: HostUser, inviteeId: string) {
        const b = await this.load(id);
        this.assertHost(b, user);
        if (!Types.ObjectId.isValid(inviteeId)) throw new BadRequestException('Invalid invitee id');
        const oid = new Types.ObjectId(inviteeId);
        const res = await this.bookingModel.updateOne(
            { _id: b._id, invitees: { $elemMatch: { _id: oid, revokedAt: { $exists: false } } } },
            { $set: { 'invitees.$.revokedAt': new Date() } },
        );
        if (!res.matchedCount) throw new NotFoundException('Invitee not found');
        return { removed: true };
    }

    async buildQrPdf(id: string, user: HostUser, opts: { inviteeId?: string; target?: string; baseUrl?: string }) {
        const b = await this.load(id);
        this.assertHost(b, user);
        if (!b.inviteMode || !b.inviteToken) {
            throw new BadRequestException('Open invitations (Private or Public) before printing a QR code');
        }
        const info = await this.bookingInfo(b);
        const base = { bookingTitle: info.title, roomName: info.roomName, startAt: info.startAt, endAt: info.endAt, mode: b.inviteMode } as const;

        const appBase = await this.appBaseUrl(opts.baseUrl); // ຄຳນວນຄັ້ງດຽວ ໃຫ້ທຸກ QR ໃນ PDF ໃຊ້ host ດຽວກັນ
        const pages: QrPageInput[] = [];
        if (b.inviteMode === InviteMode.PUBLIC || opts.target === 'door') {
            pages.push({ ...base, url: this.joinUrl(b.inviteToken, appBase) });
        } else {
            let list = b.invitees.filter((i) => !i.revokedAt);
            if (opts.inviteeId) {
                list = list.filter((i) => String(i._id) === opts.inviteeId);
                if (!list.length) throw new NotFoundException('Invitee not found');
            }
            if (!list.length) throw new BadRequestException('Add at least one guest before printing passes');
            for (const i of list) pages.push({ ...base, url: this.joinUrl(i.token, appBase), guestName: i.name, guestAccountId: i.employeeCode });
        }
        return buildQrPdf(pages);
    }

    private async attendanceRows(b: RoomBookingDocument) {
        const rows: (AttendanceRow & { method: string })[] = [];
        const joinedEntries = b.checkIns.filter((c) => c.result === 'ADMITTED');
        const via = (c?: BookingCheckIn) => (c ? (c.via === 'PERSONAL_QR' ? 'Personal QR' : 'Door QR') : '');

        if (b.inviteMode === InviteMode.PRIVATE || b.invitees.length) {
            for (const i of b.invitees) {
                if (i.revokedAt && !i.joinedAt) continue;
                const entry = joinedEntries.find((c) => c.inviteeId === String(i._id));
                rows.push({
                    name: i.name,
                    accountId: i.employeeCode ?? '',
                    contact: [i.email, i.phone].filter(Boolean).join(' / '),
                    status: i.joinedAt ? 'JOINED' : 'NOT_JOINED',
                    time: i.joinedAt ? fmtDateTime(i.joinedAt) : '',
                    method: i.joinedAt ? via(entry) : '',
                    note: i.revokedAt ? 'Removed from list after joining' : '',
                });
            }
        }
        for (const c of joinedEntries.filter((c) => !c.inviteeId)) {
            rows.push({ name: c.name, accountId: c.employeeCode ?? '', contact: c.contact ?? '', status: 'JOINED', time: fmtDateTime(c.at), method: via(c), note: '' });
        }
        for (const c of b.checkIns.filter((c) => c.result === 'DENIED')) {
            rows.push({
                name: c.name,
                accountId: c.employeeCode ?? '',
                contact: c.contact ?? '',
                status: 'DENIED',
                time: fmtDateTime(c.at),
                method: via(c),
                note: REASON_TEXT[c.reason as JoinReason] ?? c.reason ?? '',
            });
        }
        const order: Record<string, number> = { JOINED: 0, NOT_JOINED: 1, DENIED: 2 };
        rows.sort((a, b2) => order[a.status] - order[b2.status]);
        return rows;
    }

    async buildCsv(id: string, user: HostUser) {
        const b = await this.load(id);
        this.assertHost(b, user);
        const info = await this.bookingInfo(b);
        const rows = await this.attendanceRows(b);

        const header = ['Booking ID', 'Title', 'Room', 'Mode', 'Name', 'Account ID', 'Contact', 'Status', 'Time', 'Method', 'Note'];
        const data = rows.map((r) => ({
            'Booking ID': b._id,
            Title: safeCell(info.title),
            Room: safeCell(info.roomName),
            Mode: b.inviteMode ?? '',
            Name: safeCell(r.name),
            'Account ID': safeCell(r.accountId),
            Contact: safeCell(r.contact),
            Status: r.status,
            Time: r.time,
            Method: r.method,
            Note: safeCell(r.note),
        }));
        const csv = data.length ? toCsv(data) : header.join(',');
        return { csv: '\uFEFF' + csv, filename: `attendance-${b._id}.csv` };
    }

    async buildReportPdf(id: string, user: HostUser) {
        const b = await this.load(id);
        this.assertHost(b, user);
        const info = await this.bookingInfo(b);
        const rows = await this.attendanceRows(b);
        const count = (s: string) => rows.filter((r) => r.status === s).length;
        const pdfRows = rows.map(({ method, note, ...r }) => ({ ...r, note: [method, note].filter(Boolean).join(' · ') }));
        const pdf = await buildAttendancePdf({
            bookingId: String(b._id),
            bookingTitle: info.title,
            roomName: info.roomName,
            mode: b.inviteMode ?? 'NOT OPENED',
            startAt: b.startAt,
            endAt: b.endAt,
            invited: b.invitees.filter((i) => !i.revokedAt).length,
            joined: count('JOINED'),
            notJoined: count('NOT_JOINED'),
            denied: count('DENIED'),
            rows: pdfRows,
        });
        return { pdf, filename: `attendance-${b._id}.pdf` };
    }

    private async findByToken(token: string): Promise<{ booking: RoomBookingDocument; invitee?: BookingInvitee; via: Via } | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token || '')) return null;
        const door = await this.bookingModel.findOne({ inviteToken: token }).select('+inviteToken +invitees +checkIns').exec();
        if (door) return { booking: door, via: 'DOOR_QR' };
        const pass = await this.bookingModel.findOne({ 'invitees.token': token }).select('+inviteToken +invitees +checkIns').exec();
        if (!pass) return null;
        const invitee = pass.invitees.find((i) => i.token === token);
        return invitee ? { booking: pass, invitee, via: 'PERSONAL_QR' } : null;
    }

    async joinInfo(token: string, authUser?: { userId?: string } | null) {
        const found = await this.findByToken(token);
        if (!found) return { valid: false };
        const { booking, invitee, via } = found;
        const info = await this.bookingInfo(booking);
        const account = await this.loadAccount(authUser?.userId);
        return {
            valid: true,
            via,
            mode: booking.inviteMode ?? null,
            guestName: invitee?.name ?? null,
            loggedIn: !!account,
            account: account ? { name: account.name, employeeCode: account.employeeCode } : null,
            requiresAccount: !!invitee?.userId,
            needsName: !invitee && !account,
            needsContact: !invitee && !account && booking.inviteMode === InviteMode.PRIVATE,
            title: info.title,
            roomName: info.roomName,
            startAt: info.startAt,
            endAt: info.endAt,
        };
    }

    async join(token: string, dto: JoinDto, authUser?: { userId?: string } | null) {
        const found = await this.findByToken(token);
        if (!found) return { result: 'DENIED', reason: 'INVALID_QR', message: REASON_TEXT.INVALID_QR };

        const { booking, via } = found;
        let invitee = found.invitee;
        const info = await this.bookingInfo(booking);
        const publicInfo: JoinBookingInfo = { title: info.title, roomName: info.roomName, startAt: info.startAt, endAt: info.endAt };
        const account = await this.loadAccount(authUser?.userId);

        const typedName = cleanName(dto.name);
        const typedContact = (dto.contact ?? '').trim().slice(0, 120);
        const accountWho: Who | null = account
            ? {
                name: account.name,
                contact: [account.email, account.phone].filter(Boolean).join(' / '),
                userId: account.userId,
                employeeCode: account.employeeCode,
            }
            : null;
        const who = (): Who => {
            if (invitee) {
                return {
                    name: invitee.name,
                    contact: [invitee.email, invitee.phone].filter(Boolean).join(' / '),
                    userId: invitee.userId,
                    employeeCode: invitee.employeeCode,
                };
            }
            return accountWho ?? { name: typedName, contact: typedContact };
        };
        const deny = async (reason: JoinReason, w: Who = who()) => {
            await this.logDenied(booking, { ...w, inviteeId: invitee ? String(invitee._id) : undefined, reason, via });
            return { result: 'DENIED', reason, message: REASON_TEXT[reason], name: w.name || null, booking: publicInfo };
        };
        const needInfo = () => ({
            result: 'NEEDS_INFO',
            needsContact: booking.inviteMode === InviteMode.PRIVATE,
            mode: booking.inviteMode,
            booking: publicInfo,
        });
        const loginRequired = () => ({
            result: 'LOGIN_REQUIRED',
            guestName: invitee?.name ?? null,
            mode: booking.inviteMode,
            booking: publicInfo,
        });

        const now = Date.now();
        if (booking.status !== BookingStatus.CONFIRMED) return deny('BOOKING_NOT_ACTIVE');
        if (!booking.inviteMode) return deny('INVITES_CLOSED');
        if (now < booking.startAt.getTime() - EARLY_JOIN_MINUTES * 60000) return deny('TOO_EARLY');
        if (now >= booking.endAt.getTime() || booking.checkedOutAt) return deny('ENDED');

        if (invitee) {
            if (invitee.revokedAt) return deny('REVOKED');
            if (invitee.userId) {
                if (!account || !accountWho) return loginRequired();
                if (!account.isActive) return deny('ACCOUNT_INACTIVE', accountWho);
                if (account.userId !== invitee.userId) return deny('ACCOUNT_MISMATCH', accountWho);
            }
        } else if (account && accountWho && !account.isActive) {
            return deny('ACCOUNT_INACTIVE', accountWho);
        } else if (booking.inviteMode === InviteMode.PRIVATE) {
            if (account) {
                const match = booking.invitees.find((i) => !i.revokedAt && i.userId === account.userId);
                if (!match) return deny('NOT_ON_LIST');
                invitee = match;
            } else {
                if (!typedName || !typedContact) return needInfo();
                const contact = normContact(typedContact);
                const match = booking.invitees.find((i) => {
                    if (i.revokedAt || i.userId || normName(i.name) !== normName(typedName)) return false;
                    const onFile = [i.email, i.phone].filter(Boolean).map((v) => normContact(v));
                    return onFile.length === 0 || onFile.includes(contact);
                });
                if (!match) return deny('NOT_ON_LIST');
                invitee = match;
            }
        } else {
            const w = who();
            if (!w.name) return needInfo();
            const admitted = booking.checkIns.filter((c) => c.result === 'ADMITTED').length;
            const limit = Math.min(info.capacity && info.capacity > 0 ? info.capacity : HARD_MAX_ADMITTED, HARD_MAX_ADMITTED);
            const already = booking.checkIns.some((c) => c.result === 'ADMITTED' && sameGuest(c, w));
            if (!already && admitted >= limit) return deny('ROOM_FULL');
        }

        const c = who();
        const entry = {
            name: c.name,
            contact: c.contact || undefined,
            inviteeId: invitee ? String(invitee._id) : undefined,
            userId: c.userId,
            employeeCode: c.employeeCode,
            result: 'ADMITTED' as const,
            via,
            at: new Date(),
        };
        let alreadyJoined = false;

        if (invitee) {
            if (invitee.joinedAt) {
                alreadyJoined = true;
            } else {
                const res = await this.bookingModel.updateOne(
                    { _id: booking._id, invitees: { $elemMatch: { _id: invitee._id, joinedAt: { $exists: false } } } },
                    { $set: { 'invitees.$.joinedAt': entry.at }, $push: { checkIns: entry }, $addToSet: { attendees: c.name } },
                );
                alreadyJoined = !res.modifiedCount;
            }
        } else {
            alreadyJoined = booking.checkIns.some((x) => x.result === 'ADMITTED' && !x.inviteeId && sameGuest(x, c));
            if (!alreadyJoined) {
                await this.bookingModel.updateOne({ _id: booking._id }, { $push: { checkIns: entry }, $addToSet: { attendees: c.name } });
            }
        }

        if (!alreadyJoined) this.gateway.emitBookingsChanged(String(booking.roomId));
        return { result: 'ADMITTED', name: c.name, employeeCode: c.employeeCode ?? null, alreadyJoined, booking: publicInfo };
    }

    private async logDenied(
        booking: RoomBookingDocument,
        e: { name: string; contact: string; inviteeId?: string; userId?: string; employeeCode?: string; reason: JoinReason; via: Via },
    ) {
        if (!e.name) return;
        const denied = booking.checkIns.filter((c) => c.result === 'DENIED');
        if (denied.length >= MAX_DENIED_LOGS) return;
        if (denied.some((d) => d.reason === e.reason && normName(d.name) === normName(e.name) && normContact(d.contact) === normContact(e.contact))) return;
        await this.bookingModel.updateOne(
            { _id: booking._id },
            {
                $push: {
                    checkIns: {
                        name: e.name,
                        contact: e.contact || undefined,
                        inviteeId: e.inviteeId,
                        userId: e.userId,
                        employeeCode: e.employeeCode,
                        result: 'DENIED',
                        reason: e.reason,
                        via: e.via,
                        at: new Date(),
                    },
                },
            },
        );
        this.gateway.emitBookingsChanged(String(booking.roomId));
    }
}
