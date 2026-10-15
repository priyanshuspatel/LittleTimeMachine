/**
 * An error the HTTP layer knows how to answer.
 * Set `expose` to false when `message` must stay in the server log only.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, expose = true) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
