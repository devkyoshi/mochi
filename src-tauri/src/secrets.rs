//! Dev-login passwords in the OS keychain. The markdown only ever says `keychain`; the password itself
//! is stored under service `mochi` with the account `devlogin:<vm-or-project>:<username>`. These
//! commands are restricted to that namespace, so the Anthropic API key (a different account) can never
//! be read or overwritten through them.

const KEYRING_SERVICE: &str = "mochi";
const PREFIX: &str = "devlogin:";
const MAX_VALUE_LEN: usize = 500;

/// `devlogin:<name>:<username>`: name is a file-style name, the username has no whitespace or ':'.
pub fn valid_account(account: &str) -> bool {
    let Some(rest) = account.strip_prefix(PREFIX) else { return false };
    let Some((name, user)) = rest.split_once(':') else { return false };
    let name_ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let user_ok = !user.is_empty() && user.len() <= 100 && !user.chars().any(|c| c.is_whitespace() || c.is_control() || c == ':');
    name_ok && user_ok
}

pub fn valid_value(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_VALUE_LEN && !value.contains('\0')
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    if !valid_account(account) {
        return Err("That is not a dev-login account.".into());
    }
    keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    if !valid_value(&value) {
        return Err("The password must be 1 to 500 characters.".into());
    }
    entry(&account)?
        .set_password(&value)
        .map_err(|e| format!("Could not store the password in the OS keychain: {e}"))
}

#[tauri::command]
pub fn secret_has(account: String) -> bool {
    entry(&account).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

/// Returned to the UI only on an explicit Copy/Reveal click.
#[tauri::command]
pub fn secret_get(account: String) -> Result<String, String> {
    entry(&account)?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => "No password is stored for this login. Set one in Add → Dev login.".to_string(),
        other => format!("Could not read the OS keychain: {other}"),
    })
}

#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_devlogin_accounts() {
        for ok in ["devlogin:click-print:admin@click2ink.demo", "devlogin:prod_vm.1:hp", "devlogin:a:b"] {
            assert!(valid_account(ok), "{ok}");
        }
    }

    #[test]
    fn rejects_other_namespaces_and_malformed_accounts() {
        for bad in [
            "anthropic-api-key",
            "",
            "devlogin:",
            "devlogin:name",
            "devlogin::user",
            "devlogin:name:",
            "devlogin:na me:user",
            "devlogin:name:us er",
            "devlogin:name:a:b",
            "devlogin:../x:user",
            "devlogin:name:user\n",
            "Devlogin:name:user",
        ] {
            assert!(!valid_account(bad), "{bad:?}");
        }
        assert!(!valid_account(&format!("devlogin:{}:u", "n".repeat(65))));
    }

    #[test]
    fn the_api_key_account_can_never_be_reached() {
        assert!(entry("anthropic-api-key").is_err());
        assert!(secret_get("anthropic-api-key".into()).is_err());
        assert!(secret_set("anthropic-api-key".into(), "x".into()).is_err());
        assert!(secret_delete("anthropic-api-key".into()).is_err());
        assert!(!secret_has("anthropic-api-key".into()));
    }

    #[test]
    fn password_length_is_bounded() {
        assert!(valid_value("a"));
        assert!(valid_value(&"a".repeat(500)));
        assert!(!valid_value(""));
        assert!(!valid_value(&"a".repeat(501)));
        assert!(!valid_value("a\0b"));
    }
}
