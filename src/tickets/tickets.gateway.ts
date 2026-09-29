import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

export type TicketEventAction =
    | 'created'
    | 'updated'
    | 'assigned'
    | 'status-changed'
    | 'feedback'
    | 'deleted'
    | 'message';

/**
 * Broadcasts a lightweight "something changed" signal so the Issues list can
 * refetch without a manual reload. The payload intentionally carries only
 * identifiers — every client re-reads through the guarded REST API, which
 * row-scopes results per user, so no ticket data is leaked over the socket.
 */
@WebSocketGateway({
    cors: {
        origin: (process.env.FRONTEND_URLS || 'http://localhost:5173').split(','),
        credentials: true,
    },
})
export class TicketsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(TicketsGateway.name);

    constructor(private jwtService: JwtService) { }

    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth?.token ||
                (client.handshake.headers?.authorization || '').replace('Bearer ', '');

            if (!token) {
                client.disconnect();
                return;
            }

            const payload = await this.jwtService.verifyAsync(token);
            const userId = payload.sub;
            if (!userId) {
                client.disconnect();
                return;
            }

            client.data.userId = userId;
            client.join(`user:${userId}`);
            client.join('tickets');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Socket auth failed: ${message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        // socket.io removes the client from its rooms automatically
    }

    emitTicketChanged(ticketId: string, action: TicketEventAction, extra?: Record<string, unknown>) {
        this.server.to('tickets').emit('ticket:changed', {
            id: ticketId,
            action,
            at: new Date().toISOString(),
            ...extra,
        });
    }
}
