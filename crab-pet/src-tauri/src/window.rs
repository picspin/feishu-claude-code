use tauri::{window::Color, LogicalSize, PhysicalPosition, WebviewWindow};

const PET_WINDOW_WIDTH: f64 = 160.0;
const PET_WINDOW_HEIGHT: f64 = 124.0;
const DOCK_GAP: i32 = 28;

pub fn position_near_dock(window: WebviewWindow) -> Result<(), String> {
    prepare_transparent_pet_window(&window)?;

    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "no active monitor found".to_string())?;
    let work_area = monitor.work_area();
    let physical_window_size = logical_to_physical_size(
        (PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT),
        monitor.scale_factor(),
    );
    let (x, y) = dock_safe_position(
        (
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
        ),
        physical_window_size,
        DOCK_GAP,
    );

    window
        .set_size(LogicalSize::new(PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn prepare_transparent_pet_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_background_color(Some(Color(0, 0, 0, 0)))
        .map_err(|error| error.to_string())?;
    window.set_shadow(false).map_err(|error| error.to_string())?;
    Ok(())
}

fn dock_safe_position(
    work_area: (i32, i32, u32, u32),
    window_size: (u32, u32),
    gap: i32,
) -> (i32, i32) {
    let (work_x, work_y, work_width, work_height) = work_area;
    let (window_width, window_height) = window_size;
    let x = work_x + ((work_width.saturating_sub(window_width) / 2) as i32);
    let y = work_y
        + work_height
            .saturating_sub(window_height)
            .saturating_sub(gap.max(0) as u32) as i32;
    (x, y)
}

fn logical_to_physical_size(size: (f64, f64), scale_factor: f64) -> (u32, u32) {
    let scale = scale_factor.max(1.0);
    (
        (size.0 * scale).round().max(1.0) as u32,
        (size.1 * scale).round().max(1.0) as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::{dock_safe_position, logical_to_physical_size};

    #[test]
    fn positions_window_above_bottom_dock_inside_work_area() {
        assert_eq!(
            dock_safe_position((0, 25, 1440, 875), (160, 124), 28),
            (640, 748)
        );
    }

    #[test]
    fn includes_monitor_origin_for_external_displays() {
        assert_eq!(
            dock_safe_position((1440, 80, 1920, 1000), (160, 124), 28),
            (2320, 928)
        );
    }

    #[test]
    fn converts_logical_pet_size_for_retina_positioning() {
        assert_eq!(logical_to_physical_size((160.0, 124.0), 2.0), (320, 248));
    }
}
