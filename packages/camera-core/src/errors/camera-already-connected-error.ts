export class CameraAlreadyConnectedError extends Error {
  override readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = "CameraAlreadyConnectedError";
  }
}
