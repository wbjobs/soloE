import { Module } from '@nestjs/common';
import { WhiteboardModule } from './whiteboard/whiteboard.module';

@Module({
  imports: [WhiteboardModule],
})
export class AppModule {}
