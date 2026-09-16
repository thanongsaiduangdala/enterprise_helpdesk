import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
    cors: {
        origin: (process.env.FRONTEND_URLS || 'http://localhost:5173').split(','),
        credentials: true,
    },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(NotificationsGateway.name);

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

            // ໃຊ້ payload ດຽວກັນກັບ token ທີ່ອອກຕອນ login (sub = userId)
            const payload = await this.jwtService.verifyAsync(token);
            const userId = payload.sub;
            if (!userId) {
                client.disconnect();
                return;
            }

            client.data.userId = userId;
            client.join(`user:${userId}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Socket auth failed: ${message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        // socket.io ຈະລຶບ client ອອກຈາກ room ໃຫ້ອັດຕະໂນມັດ, ບໍ່ຈຳເປັນຕ້ອງເຮັດຫຍັງເພີ່ມ
    }

    // ຖືກເອີ້ນຈາກ NotificationsService ທຸກຄັ້ງທີ່ມີການແຈ້ງເຕືອນໃໝ່ຖືກສ້າງ
    notifyUser(userId: string, notification: Record<string, any>) {
        this.server.to(`user:${String(userId)}`).emit('notification:new', notification);
    }
}