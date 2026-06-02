/** Typed HTTP error so routes can `throw new ApiError(404, 'Not found')`. */
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || undefined;
  }
}

export const badRequest = (m, c) => new ApiError(400, m, c);
export const unauthorized = (m = 'Authentication required') => new ApiError(401, m);
export const forbidden = (m = 'You do not have permission to do that') => new ApiError(403, m);
export const notFound = (m = 'Not found') => new ApiError(404, m);
export const conflict = (m) => new ApiError(409, m);
export const tooMany = (m = 'Too many requests') => new ApiError(429, m);
