import type { CameraHandle } from "../types/camera";

import { CameraAlreadyConnectedError } from "../errors";

type ActiveSession = {
  connected: boolean;
  promise: Promise<unknown>;
};

export class CameraSessionRegistry {
  private readonly active = new Map<string, ActiveSession>();
  private readonly sessions = new Set<CameraHandle<string, unknown>>();

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.active.values()].map((entry) => entry.promise),
    );
    await Promise.allSettled(
      [...this.sessions].map((session) => session.close()),
    );
    this.sessions.clear();
    this.active.clear();
  }

  connect<Session extends CameraHandle<string, unknown>>(
    id: string,
    open: () => Promise<Session>,
  ): Promise<Session> {
    const existing = this.active.get(id);
    if (existing) {
      if (!existing.connected) return existing.promise as Promise<Session>;
      return Promise.reject(
        new CameraAlreadyConnectedError(
          `Camera ${id} already has an active session`,
        ),
      );
    }

    const entry: ActiveSession = {
      connected: false,
      promise: Promise.resolve(),
    };
    const pending = open().then((session) => {
      this.manageClose(id, entry, session);
      this.sessions.add(session);
      entry.connected = true;
      return session;
    });
    entry.promise = pending;
    this.active.set(id, entry);
    void pending.catch(() => {
      this.deleteIfCurrent(id, entry);
    });
    return pending;
  }

  private deleteIfCurrent(id: string, entry: ActiveSession): void {
    if (this.active.get(id) === entry) this.active.delete(id);
  }

  private manageClose(
    id: string,
    entry: ActiveSession,
    session: CameraHandle<string, unknown>,
  ): void {
    const originalClose = session.close.bind(session);
    let closed = false;
    session.close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      try {
        await originalClose();
      } finally {
        this.sessions.delete(session);
        this.deleteIfCurrent(id, entry);
      }
    };
  }
}
