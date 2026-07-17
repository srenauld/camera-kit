export class CameraDisconnectedError extends Error {
  override readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = "CameraDisconnectedError";
  }
}
