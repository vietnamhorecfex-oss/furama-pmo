export class ApiException extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiException';
  }
}
export class BadRequest extends ApiException { constructor(m = 'Bad request') { super(400, m); } }
export class Unauthorized extends ApiException { constructor(m = 'Unauthorized') { super(401, m); } }
export class Forbidden extends ApiException { constructor(m = 'Forbidden') { super(403, m); } }
export class NotFound extends ApiException { constructor(m = 'Not found') { super(404, m); } }
export class Conflict extends ApiException { constructor(m = 'Conflict') { super(409, m); } }
