//! Secret scanner: finds likely secret values in text so they are never saved to Ops Memory.
//!
//! Findings never contain the full secret; `preview` is always redacted.

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    /// One of: private_key, api_key, jwt, url_credentials, bearer_token, credential_assignment, high_entropy.
    pub kind: String,
    /// 1-based line number.
    pub line: usize,
    /// Redacted preview, safe to display and log.
    pub preview: String,
}

static PEM_BEGIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----").unwrap());
static PEM_END: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-----END [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----").unwrap());

static JWT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}").unwrap()
});

static PREFIXED_KEYS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"\b(?:",
        r"sk-[A-Za-z0-9_-]{20,}",
        r"|gh[pousr]_[A-Za-z0-9]{36,}",
        r"|github_pat_[A-Za-z0-9_]{22,}",
        r"|AKIA[0-9A-Z]{16}",
        r"|ASIA[0-9A-Z]{16}",
        r"|xox[baprs]-[A-Za-z0-9-]{10,}",
        r"|AIza[0-9A-Za-z_-]{35}",
        r"|glpat-[A-Za-z0-9_-]{20,}",
        r"|[sr]k_live_[A-Za-z0-9]{16,}",
        r"|npm_[A-Za-z0-9]{36}",
        r")"
    ))
    .unwrap()
});

static URL_CREDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s/:@]+:([^\s/@]+)@").unwrap());

static BEARER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bbearer\s+([A-Za-z0-9._~+/-]{20,}=*)").unwrap());

static ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r#"(?i)\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret[_-]?key|secret|token|api[_-]?key|apikey|"#,
        r#"private[_-]?key|access[_-]?key|credentials?))["']?\s*[:=]\s*["']?([^\s"'#,;]+)"#
    ))
    .unwrap()
});

static ENTROPY_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9+/=_-]{32,}").unwrap());

static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});

/// Words that commonly follow `password:`/`token:` in prose or docs and are not secret values.
const NON_SECRET_WORDS: &[&str] = &[
    "none", "null", "nil", "true", "false", "redacted", "example", "placeholder", "required",
    "optional", "stored", "vault", "keychain", "environment", "undefined", "empty", "unset",
];

/// True for template/placeholder values: `<value>`, `${VAR}`, `$VAR`, `{{x}}`, `xxx`, `****`, `[REDACTED]`.
fn is_placeholder(value: &str) -> bool {
    let v = value.trim_matches(|c| c == '"' || c == '\'' || c == '`');
    if v.is_empty() {
        return true;
    }
    if v.starts_with('<') || v.starts_with("${") || v.starts_with("$(") || v.starts_with("{{") || v.starts_with('%') {
        return true;
    }
    if v.starts_with('$') && v[1..].chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return true;
    }
    if v.starts_with('[') && v.ends_with(']') {
        return true;
    }
    let lower = v.to_ascii_lowercase();
    if lower.chars().all(|c| matches!(c, 'x' | '*' | '.' | '-' | '_' | '•')) {
        return true;
    }
    NON_SECRET_WORDS.contains(&lower.as_str())
}

fn redact(s: &str) -> String {
    let n = s.chars().count();
    if n <= 8 {
        "****".to_string()
    } else {
        let head: String = s.chars().take(3).collect();
        format!("{head}… ({n} chars)")
    }
}

fn shannon_entropy(s: &str) -> f64 {
    let mut counts: HashMap<char, usize> = HashMap::new();
    for c in s.chars() {
        *counts.entry(c).or_default() += 1;
    }
    let len = s.chars().count() as f64;
    counts
        .values()
        .map(|&n| {
            let p = n as f64 / len;
            -p * p.log2()
        })
        .sum()
}

fn looks_like_high_entropy_secret(token: &str) -> bool {
    if token.starts_with('/') || token.contains("//") || UUID.is_match(token) {
        return false;
    }
    // Hex digests (md5/sha1/sha256, git SHAs) are identifiers, not secrets.
    if token.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    let has_lower = token.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = token.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = token.chars().any(|c| c.is_ascii_digit());
    let has_symbol = token.chars().any(|c| matches!(c, '+' | '/' | '=' | '_' | '-'));
    let classes = [has_lower, has_upper, has_digit, has_symbol].iter().filter(|b| **b).count();
    classes >= 3 && has_digit && shannon_entropy(token) >= 4.2
}

fn has_digit_or_symbol(s: &str) -> bool {
    s.chars().any(|c| !c.is_ascii_alphabetic())
}

/// Scan `text` and return one finding per detected secret, in line order.
pub fn scan(text: &str) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut in_pem = false;

    for (idx, line) in text.lines().enumerate() {
        let line_no = idx + 1;

        if in_pem {
            if PEM_END.is_match(line) {
                in_pem = false;
            }
            continue;
        }
        if let Some(m) = PEM_BEGIN.find(line) {
            findings.push(Finding { kind: "private_key".into(), line: line_no, preview: m.as_str().to_string() });
            in_pem = !PEM_END.is_match(line);
            continue;
        }

        // Byte spans already reported on this line, so overlapping rules don't double-report.
        let mut spans: Vec<(usize, usize)> = Vec::new();
        let mut add = |kind: &str, start: usize, end: usize, preview: String, findings: &mut Vec<Finding>| {
            if spans.iter().any(|&(s, e)| start < e && s < end) {
                return;
            }
            spans.push((start, end));
            findings.push(Finding { kind: kind.into(), line: line_no, preview });
        };

        for m in JWT.find_iter(line) {
            add("jwt", m.start(), m.end(), redact(m.as_str()), &mut findings);
        }
        for m in PREFIXED_KEYS.find_iter(line) {
            if !is_placeholder(m.as_str()) {
                add("api_key", m.start(), m.end(), redact(m.as_str()), &mut findings);
            }
        }
        for c in URL_CREDS.captures_iter(line) {
            let pw = c.get(1).unwrap();
            if !is_placeholder(pw.as_str()) {
                add("url_credentials", pw.start(), pw.end(), format!("…://user:{}@…", redact(pw.as_str())), &mut findings);
            }
        }
        for c in BEARER.captures_iter(line) {
            let tok = c.get(1).unwrap();
            if !is_placeholder(tok.as_str()) {
                add("bearer_token", tok.start(), tok.end(), format!("Bearer {}", redact(tok.as_str())), &mut findings);
            }
        }
        for c in ASSIGNMENT.captures_iter(line) {
            let (key, val) = (c.get(1).unwrap(), c.get(2).unwrap());
            let v = val.as_str().trim_matches(|ch| ch == '`' || ch == '\'' || ch == '"');
            if is_placeholder(v) || v.chars().count() < 4 {
                continue;
            }
            if has_digit_or_symbol(v) || v.chars().count() >= 12 {
                add("credential_assignment", val.start(), val.end(), format!("{}={}", key.as_str(), redact(v)), &mut findings);
            }
        }
        for m in ENTROPY_TOKEN.find_iter(line) {
            if looks_like_high_entropy_secret(m.as_str()) {
                add("high_entropy", m.start(), m.end(), redact(m.as_str()), &mut findings);
            }
        }
    }
    findings
}

/// Tauri command: scan text for secrets.
#[tauri::command]
pub fn scan_secrets(text: String) -> Vec<Finding> {
    scan(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<String> {
        scan(text).into_iter().map(|f| f.kind).collect()
    }
    fn clean(text: &str) {
        let f = scan(text);
        assert!(f.is_empty(), "expected no findings for {text:?}, got {f:?}");
    }

    // Fake tokens are assembled at runtime so this source file holds no real-looking secrets.
    fn fake(prefix: &str, n: usize) -> String {
        format!("{prefix}{}", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5".chars().cycle().take(n).collect::<String>())
    }

    #[test]
    fn detects_pem_private_key_and_skips_its_body() {
        let text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx3Fq9Zk3Jf9Qx2LmP7vRtYb4NwHc8SdGa1UeI0oPzXcVbNm\nQwErTyUiOpAsDfGhJkLzXcVbNm1234567890abcdefghijklmnopqrstuvwxyzAB\n-----END RSA PRIVATE KEY-----\nafter\n";
        let f = scan(text);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "private_key");
        assert_eq!(f[0].line, 1);
        assert_eq!(f[0].preview, "-----BEGIN RSA PRIVATE KEY-----");
    }

    #[test]
    fn detects_other_pem_variants() {
        for h in ["-----BEGIN PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----", "-----BEGIN PGP PRIVATE KEY BLOCK-----"] {
            assert_eq!(kinds(h), vec!["private_key"], "{h}");
        }
    }

    #[test]
    fn public_keys_and_certificates_are_fine() {
        clean("-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAL\n-----END PUBLIC KEY-----");
        clean("-----BEGIN CERTIFICATE-----");
    }

    #[test]
    fn detects_prefixed_api_keys() {
        let samples = [
            fake("sk-", 40),
            fake("sk-ant-api03-", 40),
            fake("ghp_", 36),
            fake("gho_", 36),
            fake("github_pat_", 30),
            "AKIAIOSFODNN7EXAMPLE".to_string(),
            fake("xoxb-", 24),
            fake("glpat-", 20),
            fake("sk_live_", 24),
        ];
        for s in samples {
            let f = scan(&format!("key is {s} ok"));
            assert_eq!(f.len(), 1, "{s}: {f:?}");
            assert_eq!(f[0].kind, "api_key", "{s}");
        }
    }

    #[test]
    fn detects_google_api_key() {
        assert_eq!(kinds(&fake("AIza", 35)), vec!["api_key"]);
    }

    #[test]
    fn detects_jwt() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
        assert_eq!(kinds(&format!("token {jwt}")), vec!["jwt"]);
    }

    #[test]
    fn detects_credential_assignments() {
        for line in [
            "password=hunter2",
            "DB_PASSWORD: s3cr3tValue",
            "api_key = \"abcd1234efgh\"",
            "export SECRET_KEY='a1b2c3d4'",
            "\"client_secret\": \"Zq9x8w7v\"",
            "token: correcthorsebatterystaple",
        ] {
            assert_eq!(kinds(line), vec!["credential_assignment"], "{line}");
        }
    }

    #[test]
    fn assignment_preview_is_redacted_but_keeps_key_name() {
        let f = scan("DB_PASSWORD=SuperSecret123!");
        assert_eq!(f.len(), 1);
        assert!(f[0].preview.starts_with("DB_PASSWORD="));
        assert!(!f[0].preview.contains("SuperSecret123!"));
    }

    #[test]
    fn detects_credentials_in_urls() {
        let f = scan("DATABASE_URL=postgres://app:Pa55w0rdX@db.internal:5432/app");
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].kind, "url_credentials");
        assert!(!f[0].preview.contains("Pa55w0rdX"));
    }

    #[test]
    fn urls_without_passwords_are_fine() {
        clean("https://example.com:8443/path");
        clean("ssh://git@github.com/org/repo.git");
        clean("postgres://app@db.internal/app");
    }

    #[test]
    fn detects_bearer_tokens() {
        let f = scan(&format!("Authorization: Bearer {}", fake("", 30)));
        assert_eq!(kinds(&format!("Authorization: Bearer {}", fake("", 30))), vec!["bearer_token"], "{f:?}");
    }

    #[test]
    fn detects_high_entropy_strings() {
        let f = scan("random Zk3Jf9Qx2LmP7vRtYb4NwHc8SdGa1UeIoPz here");
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].kind, "high_entropy");
    }

    #[test]
    fn placeholders_are_allowed() {
        for line in [
            "password=<value>",
            "password: ${DB_PASSWORD}",
            "token=$API_TOKEN",
            "api_key: xxxxxxxx",
            "secret = ****",
            "password: {{ vault_password }}",
            "token: [REDACTED]",
            "SECRET=%SECRET%",
            "password=",
            "api_key: $(cat /run/secrets/key)",
            "DATABASE_URL=postgres://app:${DB_PASS}@db/app",
            "DATABASE_URL=postgres://app:<password>@db/app",
        ] {
            clean(line);
        }
    }

    #[test]
    fn prose_about_secrets_is_fine() {
        clean("password: stored in vault");
        clean("token: required");
        clean("The DATABASE_URL is set in /etc/app/.env");
        clean("Rotate the api key every 90 days");
        clean("secret manager: aws");
        clean("token_count: 5");
        clean("password policy: min 12");
    }

    #[test]
    fn does_not_flag_uuids_git_shas_and_versions() {
        clean("id 550e8400-e29b-41d4-a716-446655440000");
        clean("commit 3f786850e387550fdab836ed7e6dc881de23001b");
        clean("sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
        clean("image digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
        clean("md5 d41d8cd98f00b204e9800998ecf8427e");
        clean("nginx 1.27.2, node v24.16.0, ubuntu 24.04.1");
        clean("deployed 2026-10-07T12:34:56Z");
    }

    #[test]
    fn does_not_flag_paths_and_long_identifiers() {
        clean("/etc/nginx/sites-available/very-long-site-configuration-file-name.conf");
        clean("ThisIsAVeryLongCamelCaseIdentifierNameForSomething");
        clean("a-very-long-kebab-case-service-name-used-for-the-deployment");
        clean("https://registry.example.com/team/some-image-name-with-long-segments:1.2.3");
    }

    #[test]
    fn reports_correct_line_numbers_and_multiple_findings() {
        let text = format!("# notes\nok line\npassword=hunter2\nfine\nkey {}\n", fake("ghp_", 36));
        let f = scan(&text);
        assert_eq!(f.len(), 2);
        assert_eq!((f[0].line, f[0].kind.as_str()), (3, "credential_assignment"));
        assert_eq!((f[1].line, f[1].kind.as_str()), (5, "api_key"));
    }

    #[test]
    fn overlapping_rules_report_once() {
        let f = scan(&format!("api_key={}", fake("sk-", 40)));
        assert_eq!(f.len(), 1, "{f:?}");
    }

    #[test]
    fn handles_crlf_and_empty_input() {
        assert!(scan("").is_empty());
        let f = scan("a\r\npassword=hunter2\r\nb\r\n");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].line, 2);
    }

    #[test]
    fn previews_never_contain_the_full_secret() {
        let secrets = [fake("sk-", 40), fake("ghp_", 36), "AKIAIOSFODNN7EXAMPLE".to_string()];
        for s in secrets {
            for f in scan(&format!("x {s} y")) {
                assert!(!f.preview.contains(&s), "preview leaks secret: {}", f.preview);
            }
        }
        let f = scan("password=hunter2");
        assert!(!f[0].preview.contains("hunter2"));
    }

    #[test]
    fn redact_hides_short_values_entirely() {
        assert_eq!(redact("abc"), "****");
        assert_eq!(redact("12345678"), "****");
        assert!(redact("123456789").starts_with("123…"));
    }

    #[test]
    fn shipped_templates_and_scaffold_files_are_clean() {
        for (name, text) in [
            ("vm", include_str!("../../templates/vm.md")),
            ("project", include_str!("../../templates/project.md")),
            ("changelog", include_str!("../../templates/changelog.md")),
            ("changelog-entry", include_str!("../../templates/changelog-entry.md")),
            ("inbox", include_str!("../../templates/inbox.md")),
        ] {
            let f = scan(text);
            assert!(f.is_empty(), "template {name} is flagged: {f:?}");
        }
    }

    #[test]
    fn scan_secrets_command_matches_scan() {
        assert_eq!(scan_secrets("password=hunter2".into()), scan("password=hunter2"));
    }
}
