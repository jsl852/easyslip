export class BooksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BooksError";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export function publicError(error: unknown, fallback: string): string {
  if (error instanceof BooksError) return error.message;
  if (isUniqueViolation(error)) return "That code or name is already in use.";
  return fallback;
}
