import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * ບອກໜ້າຈໍທຸກໜ້າທີ່ເປີດຢູ່ ໃຫ້ດຶງຂໍ້ມູນໃໝ່ເມື່ອຂໍ້ມູນສາງ/ຊັບສິນປ່ຽນ (real-time ໂດຍບໍ່ຕ້ອງ reload).
 * ກວມ: ຄຳຂໍອຸປະກອນ, catalog, ທະບຽນຊັບສິນ, ຮັບເຄື່ອງເຂົ້າຄັງ, ໃບສະເໜີຊື້.
 *
 * Event ບໍ່ມີຂໍ້ມູນຈິງ — ມີແຕ່ຊື່ resource ແລະເວລາ. ໜ້າຈໍຈະເອີ້ນ API ຕາມປົກກະຕິ ຈຶ່ງຖືກກວດສິດເໝືອນເດີມ.
 * ການຢືນຢັນຕົວຕົນຂອງ socket ເຮັດໂດຍ NotificationsGateway (ຕັດ socket ທີ່ບໍ່ມີ token ທີ່ຖືກຕ້ອງ).
 */
@WebSocketGateway({
  cors: {
    origin: (process.env.FRONTEND_URLS || 'http://localhost:5173').split(','),
    credentials: true,
  },
})
export class InventoryGateway {
  @WebSocketServer()
  server!: Server;

  emitChanged(resource?: string) {
    // server ອາດຍັງບໍ່ພ້ອມ (ຕອນ bootstrap) — ບໍ່ໃຫ້ການບັນທຶກຂໍ້ມູນລົ້ມເພາະສົ່ງ real-time ບໍ່ໄດ້
    this.server?.emit('inventory:changed', {
      resource: resource || null,
      at: new Date(),
    });
  }
}
