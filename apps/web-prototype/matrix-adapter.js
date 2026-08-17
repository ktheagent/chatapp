/**
 * Production integration boundary.
 * No fake encryption is implemented here.
 */
export class MessagingAdapter {
  async register(_input) { throw new Error("Not implemented"); }
  async login(_input) { throw new Error("Not implemented"); }
  async logout() { throw new Error("Not implemented"); }
  async startSync() { throw new Error("Not implemented"); }
  async createEncryptedDirectRoom(_userId) { throw new Error("Not implemented"); }
  async sendText(_roomId, _body) { throw new Error("Not implemented"); }
  async sendMedia(_roomId, _file) { throw new Error("Not implemented"); }
  async listRooms() { throw new Error("Not implemented"); }
  async getTimeline(_roomId) { throw new Error("Not implemented"); }
  async verifyDevice(_deviceId) { throw new Error("Not implemented"); }
}
