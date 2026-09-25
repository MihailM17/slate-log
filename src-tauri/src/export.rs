use crate::db::{Scene, Take};
use rust_xlsxwriter::{Format, Workbook};
use std::collections::{BTreeMap, BTreeSet};

fn write_take_row(
    ws: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    scene: &Scene,
    t: &Take,
    wrap: &Format,
) -> Result<(), String> {
    let ie = if t.int_ext.is_empty() { &scene.int_ext } else { &t.int_ext };
    let day = if t.day == 0 { scene.day } else { t.day };
    ws.write_string(row, 0, &scene.number).map_err(|e| e.to_string())?;
    ws.write_string(row, 1, &scene.title).map_err(|e| e.to_string())?;
    ws.write_string(row, 2, &scene.location).map_err(|e| e.to_string())?;
    ws.write_number(row, 3, day as f64).map_err(|e| e.to_string())?;
    ws.write_string(row, 4, ie).map_err(|e| e.to_string())?;
    ws.write_number(row, 5, t.take_no as f64).map_err(|e| e.to_string())?;
    ws.write_string(row, 6, &t.tc_in).map_err(|e| e.to_string())?;
    ws.write_string(row, 7, &t.cam).map_err(|e| e.to_string())?;
    ws.write_string(row, 8, &t.lens).map_err(|e| e.to_string())?;
    ws.write_string(row, 9, &t.rating).map_err(|e| e.to_string())?;
    ws.write_string(row, 10, &t.tags).map_err(|e| e.to_string())?;
    ws.write_string_with_format(row, 11, &t.note, wrap)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Writes All Takes (+ Good Selects + Days when enabled). Returns Ok(()) on success.
pub fn write_workbook(
    path: &str,
    scenes: &[Scene],
    takes_by_scene: &[(Scene, Vec<Take>)],
    include_good: bool,
    include_days: bool,
) -> Result<(), String> {
    let _ = scenes; // grouping comes from takes_by_scene
    let mut workbook = Workbook::new();

    let header = Format::new().set_bold().set_background_color("#B44332").set_font_color("#FFFFFF");
    let wrap = Format::new().set_text_wrap();

    // --- Sheet 1: All takes ---
    let ws = workbook.add_worksheet();
    ws.set_name("All Takes").map_err(|e| e.to_string())?;
    let headers = ["Scene", "Title", "Location", "Day", "INT/EXT", "Take", "TC In", "Cam", "Lens", "Rating", "Quick notes", "Description"];
    for (c, h) in headers.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, *h, &header)
            .map_err(|e| e.to_string())?;
    }
    let mut row: u32 = 1;
    // day -> (scenes, takes, good)
    let mut per_day: BTreeMap<i64, (BTreeSet<String>, i64, i64)> = BTreeMap::new();
    for (scene, takes) in takes_by_scene {
        for t in takes {
            write_take_row(ws, row, scene, t, &wrap)?;
            row += 1;
            let day = if t.day == 0 { scene.day } else { t.day };
            let e = per_day.entry(day).or_insert_with(|| (BTreeSet::new(), 0, 0));
            e.0.insert(scene.number.clone());
            e.1 += 1;
            if t.rating == "Good" {
                e.2 += 1;
            }
        }
    }
    // Scenes with no takes still count toward their day
    for (scene, takes) in takes_by_scene {
        if takes.is_empty() {
            let day = if scene.day == 0 { 1 } else { scene.day };
            per_day.entry(day).or_insert_with(|| (BTreeSet::new(), 0, 0)).0.insert(scene.number.clone());
        }
    }
    ws.autofit();

    // --- Sheet 2: Good selects only ---
    if include_good {
        let ws2 = workbook.add_worksheet();
        ws2.set_name("Good Selects").map_err(|e| e.to_string())?;
        for (c, h) in headers.iter().enumerate() {
            ws2.write_string_with_format(0, c as u16, *h, &header)
                .map_err(|e| e.to_string())?;
        }
        let mut row2: u32 = 1;
        for (scene, takes) in takes_by_scene {
            for t in takes.iter().filter(|t| t.rating == "Good") {
                write_take_row(ws2, row2, scene, t, &wrap)?;
                row2 += 1;
            }
        }
        ws2.autofit();
    }

    // --- Sheet 3: per-day stats ---
    if include_days {
        let ws3 = workbook.add_worksheet();
        ws3.set_name("Days").map_err(|e| e.to_string())?;
        for (c, h) in ["Day", "Scenes", "Takes", "Good"].iter().enumerate() {
            ws3.write_string_with_format(0, c as u16, *h, &header)
                .map_err(|e| e.to_string())?;
        }
        let mut row3: u32 = 1;
        for (day, (scene_set, takes, good)) in &per_day {
            ws3.write_number(row3, 0, *day as f64).map_err(|e| e.to_string())?;
            ws3.write_number(row3, 1, scene_set.len() as f64).map_err(|e| e.to_string())?;
            ws3.write_number(row3, 2, *takes as f64).map_err(|e| e.to_string())?;
            ws3.write_number(row3, 3, *good as f64).map_err(|e| e.to_string())?;
            row3 += 1;
        }
        ws3.autofit();
    }

    workbook.save(path).map_err(|e| e.to_string())?;
    Ok(())
}
