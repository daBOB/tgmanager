// tests/mocks/telegram-client-mock.ts
import { EventEmitter } from 'events';

export interface MockMessage {
  id: number;
  message?: string;
  media?: any;
}

/**
 * Mock Telegram client for testing without real API calls
 */
export class MockTelegramClient extends EventEmitter {
  private messages: Map<number, MockMessage> = new Map();
  private nextMessageId = 1;
  private uploadedFiles: Map<number, Buffer> = new Map();

  async invoke(request: any): Promise<any> {
    const className = request.className || request.constructor?.name;

    if (className === 'GetFullUser') {
      return {
        users: [{ premium: false }]
      };
    }

    if (className === 'channels.CreateChannel' || className === 'CreateChannel') {
      // Return a structure that mimics Api.Channel with id having toJSNumber method
      const mockChannel = {
        id: {
          toJSNumber: () => 123456789,
          value: BigInt(123456789)
        },
        title: 'TGManager Storage',
        broadcast: true
      };
      return {
        chats: [mockChannel]
      };
    }

    return {};
  }

  async getDialogs(_options?: any): Promise<any[]> {
    return [];
  }

  async sendFile(_chatId: string, options: any): Promise<MockMessage> {
    const messageId = this.nextMessageId++;
    const message: MockMessage = {
      id: messageId,
      media: { document: true }
    };

    // Store file content if it's a buffer
    if (options.file instanceof Buffer) {
      this.uploadedFiles.set(messageId, options.file);
    }

    this.messages.set(messageId, message);

    // Simulate progress
    if (options.progressCallback) {
      options.progressCallback(0.5);
      options.progressCallback(1.0);
    }

    return message;
  }

  async sendMessage(_chatId: string, options: any): Promise<MockMessage> {
    const messageId = this.nextMessageId++;
    const message: MockMessage = {
      id: messageId,
      message: options.message
    };
    this.messages.set(messageId, message);
    return message;
  }

  async getMessages(_chatId: string, options: any): Promise<MockMessage[]> {
    if (options.ids) {
      return options.ids
        .map((id: number) => this.messages.get(id))
        .filter(Boolean);
    }

    if (options.search) {
      return Array.from(this.messages.values())
        .filter(m => m.message?.includes(options.search));
    }

    // Mirror Telegram's history semantics: newest first, `offsetId` exclusive
    // and walking backwards. Without this the mock would hand back the whole
    // store on every call and pagination bugs would stay invisible to tests.
    const newestFirst = Array.from(this.messages.values()).sort((a, b) => b.id - a.id);
    const offsetId: number | undefined = options.offsetId;
    const startFrom = offsetId === undefined
      ? newestFirst
      : newestFirst.filter(m => m.id < offsetId);

    return startFrom.slice(0, options.limit ?? 100);
  }

  async downloadMedia(message: MockMessage, options?: any): Promise<Buffer | null> {
    const buffer = this.uploadedFiles.get(message.id);

    if (buffer && options?.progressCallback) {
      options.progressCallback(0.5);
      options.progressCallback(1.0);
    }

    return buffer || Buffer.from('mock-content');
  }

  async deleteMessages(_chatId: string, ids: number[], _options?: any): Promise<void> {
    for (const id of ids) {
      this.messages.delete(id);
      this.uploadedFiles.delete(id);
    }
  }

  // Test helpers
  _reset(): void {
    this.messages.clear();
    this.uploadedFiles.clear();
    this.nextMessageId = 1;
  }

  _getMessageCount(): number {
    return this.messages.size;
  }
}
