import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: (process.env.FRONTEND_URLS || 'http://localhost:5173').split(','),
    credentials: true,
  },
})
export class RoomBookingsGateway {
  @WebSocketServer()
  server!: Server;

  // ເມື່ອການຈອງຫ້ອງປ່ຽນແປງ (ຈອງໃໝ່ / ອະນຸມັດ / ປະຕິເສດ / ຍົກເລີກ / ເລື່ອນເວລາ / check-in / check-out) —
  // ບອກໜ້າຈໍທຸກໜ້າທີ່ເປີດຢູ່ໃຫ້ດຶງຂໍ້ມູນມາສະແດງໃໝ່ແບບ real-time ໂດຍບໍ່ຕ້ອງ reload
  // bookingId (ບໍ່ບັງຄັບ) — ບອກວ່າການຈອງໃດປ່ຽນ ເພື່ອໃຫ້ແຜງລາຍຊື່ຜູ້ຖືກເຊີນຂອງການຈອງນັ້ນດຶງຂໍ້ມູນໃໝ່ທັນທີ ໂດຍບໍ່ຕ້ອງລໍຖ້າ polling
  emitBookingsChanged(roomId?: string, bookingId?: string) {
    // server ອາດຍັງບໍ່ພ້ອມ (ຕອນ bootstrap) — ບໍ່ໃຫ້ການຈອງ/check-out ລົ້ມເພາະສົ່ງ real-time ບໍ່ໄດ້
    this.server?.emit('room-bookings:changed', {
      roomId: roomId || null,
      bookingId: bookingId || null,
      at: new Date(),
    });
  }

  // ເມື່ອຂໍ້ມູນຂອງຕົວຫ້ອງ (ສ້າງ / ແກ້ / ລຶບ / ປິດບຳລຸງ) ປ່ຽນແປງ
  emitRoomsChanged(roomId?: string) {
    this.server?.emit('room:changed', {
      roomId: roomId || null,
      at: new Date(),
    });
  }
}
