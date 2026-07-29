export function isPrismaMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');

  return /table .* does not exist|relation .* does not exist|does not exist in the current database|does not exist/i.test(message);
}
