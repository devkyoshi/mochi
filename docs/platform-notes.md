# Dock platform notes

Window: frameless, transparent, always-on-top, skip-taskbar, hidden until placed, pinned top-center of the monitor under the cursor (hotkey) or the saved monitor (startup). Config in the OS app-config dir (`config.json`, no secrets).

Verified on Windows 11 (launch, window creation, hotkey registration without error). macOS and Linux are untested.

## Behaviour
- Collapsed pill 132x48, expanded 720x420 (logical px; raised from the proposal's 240 so Browse is usable). The OS window is resized by Rust (`set_dock_state`); the CSS animates inside it. Collapse waits 200 ms so the animation finishes before the window shrinks.
- Default hotkey `CommandOrControl+Shift+Space`; changing it re-registers, and a failed change restores the old one.
- Auto-collapse listens to the window focus-lost event.

## Caveats
- **Windows:** transparent windows need WebView2; `shadow: false` avoids a faint border. Another app may already own the hotkey (registration error is printed and the pill still works by click).
- **macOS:** transparency requires `macOSPrivateApi` (enabled; incompatible with Mac App Store distribution). Global shortcuts may need no extra permission. Dock/menu bar overlap: top margin may need adjusting for the notch/menu bar.
- **Linux:** Wayland compositors often ignore always-on-top, window positioning and global shortcuts; X11 works. Transparency needs a compositor.
- **Click-through on transparent areas** is not implemented: the window is resized to fit the pill/panel instead, so no large transparent area blocks clicks. Revisit if the panel grows.
- Multi-monitor: monitor is chosen by cursor position, then saved monitor name, then first monitor.
