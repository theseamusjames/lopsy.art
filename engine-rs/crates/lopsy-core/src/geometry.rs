use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewportState {
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub screen_width: f64,
    pub screen_height: f64,
}

impl ViewportState {
    pub fn new(zoom: f64, pan_x: f64, pan_y: f64, screen_width: f64, screen_height: f64) -> Self {
        Self { zoom, pan_x, pan_y, screen_width, screen_height }
    }
}

/// Convert screen coordinates to canvas (document) coordinates
pub fn screen_to_canvas(
    screen_x: f64, screen_y: f64,
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> (f64, f64) {
    let cx = (screen_x - view_width / 2.0) / zoom + pan_x;
    let cy = (screen_y - view_height / 2.0) / zoom + pan_y;
    (cx, cy)
}

/// Convert canvas (document) coordinates to screen coordinates
pub fn canvas_to_screen(
    canvas_x: f64, canvas_y: f64,
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> (f64, f64) {
    let sx = (canvas_x - pan_x) * zoom + view_width / 2.0;
    let sy = (canvas_y - pan_y) * zoom + view_height / 2.0;
    (sx, sy)
}

/// Get the visible region in canvas coordinates
pub fn get_visible_region(
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> (f64, f64, f64, f64) {
    let (left, top) = screen_to_canvas(0.0, 0.0, zoom, pan_x, pan_y, view_width, view_height);
    let (right, bottom) = screen_to_canvas(view_width, view_height, zoom, pan_x, pan_y, view_width, view_height);
    (left, top, right - left, bottom - top)
}

/// Convert a screen-space delta to canvas-space delta
pub fn screen_delta_to_canvas(dx: f64, dy: f64, zoom: f64) -> (f64, f64) {
    (dx / zoom, dy / zoom)
}

impl Rect {
    pub fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self { x, y, width, height }
    }

    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.x + self.width as i32
            && py >= self.y && py < self.y + self.height as i32
    }

    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let x1 = self.x.max(other.x);
        let y1 = self.y.max(other.y);
        let x2 = (self.x + self.width as i32).min(other.x + other.width as i32);
        let y2 = (self.y + self.height as i32).min(other.y + other.height as i32);
        if x2 > x1 && y2 > y1 {
            Some(Rect::new(x1, y1, (x2 - x1) as u32, (y2 - y1) as u32))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_screen_canvas_roundtrip() {
        let (zoom, px, py, vw, vh) = (2.0, 100.0, 50.0, 800.0, 600.0);
        let (cx, cy) = screen_to_canvas(300.0, 200.0, zoom, px, py, vw, vh);
        let (sx, sy) = canvas_to_screen(cx, cy, zoom, px, py, vw, vh);
        assert!((sx - 300.0).abs() < 1e-10);
        assert!((sy - 200.0).abs() < 1e-10);
    }

    #[test]
    fn test_screen_to_canvas_center() {
        // Center of screen maps to pan position
        let (cx, cy) = screen_to_canvas(400.0, 300.0, 1.0, 50.0, 25.0, 800.0, 600.0);
        assert!((cx - 50.0).abs() < 1e-10);
        assert!((cy - 25.0).abs() < 1e-10);
    }

    #[test]
    fn test_screen_delta() {
        let (dx, dy) = screen_delta_to_canvas(20.0, 10.0, 2.0);
        assert!((dx - 10.0).abs() < 1e-10);
        assert!((dy - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_visible_region() {
        let (x, y, w, h) = get_visible_region(1.0, 0.0, 0.0, 800.0, 600.0);
        assert!((x - -400.0).abs() < 1e-10);
        assert!((y - -300.0).abs() < 1e-10);
        assert!((w - 800.0).abs() < 1e-10);
        assert!((h - 600.0).abs() < 1e-10);
    }

    #[test]
    fn test_rect_contains() {
        let r = Rect::new(10, 20, 100, 50);
        assert!(r.contains(10, 20));
        assert!(r.contains(50, 40));
        assert!(!r.contains(9, 20));
        assert!(!r.contains(110, 20));
    }

    #[test]
    fn test_rect_intersect() {
        let a = Rect::new(0, 0, 100, 100);
        let b = Rect::new(50, 50, 100, 100);
        let i = a.intersect(&b).unwrap();
        assert_eq!(i, Rect::new(50, 50, 50, 50));

        let c = Rect::new(200, 200, 10, 10);
        assert!(a.intersect(&c).is_none());
    }
}
