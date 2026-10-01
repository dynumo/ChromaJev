/** Application errors carry an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'invalid_request', message, details);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'forbidden', message);
export const unauthorised = (message = 'Authentication required.') => new AppError(401, 'unauthorised', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
