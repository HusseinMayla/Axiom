/**
 * Commands from the model run inside Docker but still have a repository token.
 * Keep the policy narrow: dependent && chains are useful; hidden side effects
 * and credential-bearing Git/network operations are not.
 */
export function commandPolicyViolation(command: string): string | null {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return "an empty command is not allowed";
  if (/\brm\s+-[a-z-]*r[a-z-]*(?:\s|$)/.test(normalized)) return "recursive deletion is not allowed";
  // The developer command is executed by `bash -lc`. Keep its shell surface
  // deliberately small: a dependent `&&` chain is useful for setup + verify,
  // while other operators can hide extra work or bypass an observed failure.
  if (/(?:;|\|\||(?<!&)&(?!&)|\||\r|\n|`|\$\()/.test(normalized)) {
    return "only a short && chain is allowed";
  }
  if (/\bgit\s+(?:push|commit|reset|checkout|clean|config)\b/.test(normalized)) return "Git mutation is managed by the harness";
  if (/\bdocker\b/.test(normalized)) return "Docker is managed by the harness";
  if (/\b(?:curl|wget)\b/.test(normalized)) return "direct network fetches are not allowed";
  return null;
}
