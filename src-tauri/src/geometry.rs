//! Pure window-placement maths for the dock (all values in physical pixels unless stated).

#[derive(Debug, Clone, PartialEq)]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Logical (DPI-independent) dock sizes.
pub const COLLAPSED_SIZE: (f64, f64) = (132.0, 48.0);
pub const EXPANDED_SIZE: (f64, f64) = (720.0, 420.0);

/// Place a window of `logical` size at the top-center of `monitor`, `top_margin` logical px from the top.
pub fn dock_rect(monitor: &MonitorInfo, logical: (f64, f64), top_margin: f64) -> Rect {
    let width = ((logical.0 * monitor.scale).round() as u32).min(monitor.width);
    let height = ((logical.1 * monitor.scale).round() as u32).min(monitor.height);
    let x = monitor.x + ((monitor.width - width) / 2) as i32;
    let y = monitor.y + (top_margin * monitor.scale).round() as i32;
    Rect { x, y, width, height }
}

fn contains(m: &MonitorInfo, point: (f64, f64)) -> bool {
    point.0 >= m.x as f64
        && point.0 < m.x as f64 + m.width as f64
        && point.1 >= m.y as f64
        && point.1 < m.y as f64 + m.height as f64
}

/// Pick the monitor to show the dock on: the one under the cursor, else the saved one by name,
/// else the first (primary). Returns `None` only when there are no monitors.
pub fn choose_monitor(
    monitors: &[MonitorInfo],
    cursor: Option<(f64, f64)>,
    saved_name: Option<&str>,
) -> Option<usize> {
    if let Some(p) = cursor {
        if let Some(i) = monitors.iter().position(|m| contains(m, p)) {
            return Some(i);
        }
    }
    if let Some(name) = saved_name {
        if let Some(i) = monitors.iter().position(|m| m.name.as_deref() == Some(name)) {
            return Some(i);
        }
    }
    if monitors.is_empty() {
        None
    } else {
        Some(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(name: &str, x: i32, y: i32, w: u32, h: u32, scale: f64) -> MonitorInfo {
        MonitorInfo { name: Some(name.into()), x, y, width: w, height: h, scale }
    }

    #[test]
    fn centers_at_top_of_a_1080p_monitor() {
        let r = dock_rect(&mon("A", 0, 0, 1920, 1080, 1.0), (720.0, 240.0), 0.0);
        assert_eq!(r, Rect { x: 600, y: 0, width: 720, height: 240 });
    }

    #[test]
    fn scales_logical_size_for_hidpi() {
        let r = dock_rect(&mon("A", 0, 0, 3840, 2160, 2.0), (720.0, 240.0), 8.0);
        assert_eq!(r, Rect { x: 1200, y: 16, width: 1440, height: 480 });
    }

    #[test]
    fn respects_secondary_monitor_offsets_including_negative() {
        let right = dock_rect(&mon("B", 1920, 0, 1920, 1080, 1.0), (720.0, 240.0), 0.0);
        assert_eq!(right.x, 1920 + 600);
        let left = dock_rect(&mon("C", -1280, -200, 1280, 1024, 1.0), (720.0, 240.0), 0.0);
        assert_eq!((left.x, left.y), (-1280 + 280, -200));
    }

    #[test]
    fn never_exceeds_the_monitor() {
        let r = dock_rect(&mon("tiny", 0, 0, 500, 200, 1.0), (720.0, 240.0), 0.0);
        assert_eq!((r.width, r.height), (500, 200));
        assert_eq!(r.x, 0);
    }

    #[test]
    fn collapsed_and_expanded_share_the_same_center() {
        let m = mon("A", 0, 0, 1920, 1080, 1.0);
        let c = dock_rect(&m, COLLAPSED_SIZE, 0.0);
        let e = dock_rect(&m, EXPANDED_SIZE, 0.0);
        assert_eq!(c.x as u32 * 2 + c.width, e.x as u32 * 2 + e.width);
    }

    #[test]
    fn chooses_monitor_under_cursor_first() {
        let ms = [mon("A", 0, 0, 1920, 1080, 1.0), mon("B", 1920, 0, 1920, 1080, 1.0)];
        assert_eq!(choose_monitor(&ms, Some((2500.0, 300.0)), Some("A")), Some(1));
        assert_eq!(choose_monitor(&ms, Some((10.0, 10.0)), Some("B")), Some(0));
    }

    #[test]
    fn falls_back_to_saved_name_then_first() {
        let ms = [mon("A", 0, 0, 1920, 1080, 1.0), mon("B", 1920, 0, 1920, 1080, 1.0)];
        assert_eq!(choose_monitor(&ms, None, Some("B")), Some(1));
        assert_eq!(choose_monitor(&ms, Some((-50.0, -50.0)), Some("B")), Some(1));
        assert_eq!(choose_monitor(&ms, None, Some("gone")), Some(0));
        assert_eq!(choose_monitor(&ms, None, None), Some(0));
    }

    #[test]
    fn no_monitors_gives_none() {
        assert_eq!(choose_monitor(&[], Some((0.0, 0.0)), None), None);
    }

    #[test]
    fn monitor_edges_are_half_open() {
        let ms = [mon("A", 0, 0, 100, 100, 1.0), mon("B", 100, 0, 100, 100, 1.0)];
        assert_eq!(choose_monitor(&ms, Some((100.0, 50.0)), None), Some(1));
        assert_eq!(choose_monitor(&ms, Some((99.9, 50.0)), None), Some(0));
    }
}
