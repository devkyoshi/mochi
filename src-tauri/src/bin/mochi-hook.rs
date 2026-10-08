//! Hook helper for Claude Code (Stop / SessionEnd). Reads the hook JSON from stdin and, if needed,
//! prints a block decision. Any failure or panic means "allow": exit 0 with no output.

use std::io::{Read, Write};

fn main() {
    let result = std::panic::catch_unwind(|| {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut stdin = String::new();
        let _ = std::io::stdin().take(20_000_000).read_to_string(&mut stdin);
        let exe = std::env::current_exe().unwrap_or_default();
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        mochi_lib::hook::run(&args, &stdin, &exe, &date)
    });
    match result {
        Ok(outcome) => {
            if !outcome.stdout.is_empty() {
                let _ = std::io::stdout().write_all(outcome.stdout.as_bytes());
            }
            std::process::exit(outcome.exit_code);
        }
        Err(_) => std::process::exit(0),
    }
}
