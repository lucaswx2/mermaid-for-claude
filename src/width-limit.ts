// Width limit (ADR-0005, ADR-0008): MERMAID_FOR_CLAUDE_MAX_WIDTH when it is a positive integer, else 120.
// The live terminal width slots in between the two once it exists. The SessionStart script carries a
// second copy of the default; a parity test keeps the two equal.
export const DEFAULT_WIDTH_LIMIT = 120;

export const resolveWidthLimit = (override: string | undefined) => {
  const trimmed = override?.trim() ?? '';
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : DEFAULT_WIDTH_LIMIT;
};
