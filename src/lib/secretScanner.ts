import { invoke } from "@tauri-apps/api/core";

export type SecretKind =
  | "private_key"
  | "api_key"
  | "jwt"
  | "url_credentials"
  | "bearer_token"
  | "credential_assignment"
  | "high_entropy";

export interface SecretFinding {
  kind: SecretKind;
  /** 1-based line number. */
  line: number;
  /** Redacted preview; never contains the full secret. */
  preview: string;
}

const LABELS: Record<SecretKind, string> = {
  private_key: "private key",
  api_key: "API key",
  jwt: "JWT",
  url_credentials: "password in URL",
  bearer_token: "bearer token",
  credential_assignment: "credential value",
  high_entropy: "high-entropy string",
};

/** Scan text for secrets using the Rust scanner. */
export function scanSecrets(text: string): Promise<SecretFinding[]> {
  return invoke<SecretFinding[]>("scan_secrets", { text });
}

/** One user-facing line per finding, e.g. `Line 3: credential value (DB_PASSWORD=Sup… (17 chars))`. */
export function describeFindings(findings: SecretFinding[]): string[] {
  return findings.map((f) => `Line ${f.line}: ${LABELS[f.kind] ?? f.kind} (${f.preview})`);
}
