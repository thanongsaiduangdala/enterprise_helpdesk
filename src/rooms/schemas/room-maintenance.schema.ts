import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomMaintenanceDocument = RoomMaintenance & Document;

@Schema({ timestamps: true })
export class RoomMaintenance {
  @Prop({ type: String, ref: 'Room', required: true })
  roomId!: string;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop()
  reason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const RoomMaintenanceSchema =
  SchemaFactory.createForClass(RoomMaintenance);
RoomMaintenanceSchema.index({ roomId: 1, startAt: 1, endAt: 1 });
