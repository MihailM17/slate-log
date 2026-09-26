use crate::db::{Scene, TakeWithScene};
use printpdf::{Mm, PdfDocument};
use rust_xlsxwriter::{Format, Workbook};
use std::collections::{BTreeMap, BTreeSet};

const INTER: &[u8] = include_bytes!("../assets/fonts/Inter-400.ttf");
const INTER_BOLD: &[u8] = include_bytes!("../assets/fonts/Inter-700.ttf");

// ---------- Timecode helpers (non-drop) ----------

pub fn parse_tc(s: &str) -> Option<(u32, u32, u32, u32)> {
    let p: Vec<&str> = s.trim().split(':').collect();
    if p.len() < 3 || p.len() > 4 {
        return None;
    }
    let h = p[0].parse().ok()?;
    let m = p[1].parse().ok()?;
    let sec = p[2].parse().ok()?;
    let f = if p.len() == 4 { p[3].parse().ok()? } else { 0 };
    if m > 59 || sec > 59 {
        return None;
    }
    Some((h, m, sec, f))
}

pub fn tc_to_frames(s: &str, fps: f64) -> Option<f64> {
    let (h, m, sec, f) = parse_tc(s)?;
    Some((((h * 3600 + m * 60 + sec) as f64) * fps) + f as f64)
}

pub fn frames_to_tc(frames: f64, fps: f64) -> String {
    let fps = if fps > 0.0 { fps } else { 25.0 };
    let total = frames.round().max(0.0) as u64;
    let fp = fps.round().max(1.0) as u64;
    let f = total % fp;
    let s = (total / fp) % 60;
    let m = (total / (fp * 60)) % 60;
    let h = total / (fp * 3600);
    format!("{h:02}:{m:02}:{s:02}:{f:02}")
}

fn reel_name(cam_file: &str, scene: &str, take: i64) -> String {
    let stem = cam_file.rsplit_once('.').map(|(s, _)| s).unwrap_or(cam_file);
    let clean: String = stem.chars().filter(|c| c.is_alphanumeric()).take(8).collect::<String>().to_uppercase();
    if clean.is_empty() {
        format!("SC{}TK{}", scene.replace(' ', ""), take)
            .chars().filter(|c| c.is_alphanumeric()).take(8).collect::<String>().to_uppercase()
    } else {
        clean
    }
}

/// CMX3600 selects timeline (Good takes, record timeline runs sequentially
/// from 01:00:00:00). Imports into Resolve / Premiere / Avid.
/// Returns (events, skipped).
pub fn write_edl(path: &str, title: &str, fps: f64, takes: &[TakeWithScene]) -> Result<(usize, usize), String> {
    let fps = if fps > 0.0 && fps < 1000.0 { fps } else { 25.0 };
    let goods: Vec<&TakeWithScene> = takes.iter().filter(|t| t.rating == "Good").collect();
    let mut out = format!("TITLE: {title} SELECTS\nFCM: NON-DROP FRAME\n\n");
    let mut rec = tc_to_frames("01:00:00:00", fps).unwrap_or(0.0);
    let (mut events, mut skipped) = (0usize, 0usize);
    for (i, t) in goods.iter().enumerate() {
        let src_in = match tc_to_frames(&t.tc_in, fps) {
            Some(f) => f,
            None => { skipped += 1; continue; }
        };
        let dur = if t.duration_sec > 0.0 { t.duration_sec } else { 5.0 };
        let src_out = src_in + dur * fps;
        let rec_out = rec + dur * fps;
        let reel = reel_name(&t.cam_file, &t.scene_number, t.take_no);
        let clip = if t.cam_file.is_empty() {
            format!("Scene {} Take {:02}", t.scene_number, t.take_no)
        } else {
            t.cam_file.clone()
        };
        out.push_str(&format!(
            "{:03}  {:8} V     C        {} {} {} {}\n* FROM CLIP NAME: {}\n",
            i + 1, reel,
            frames_to_tc(src_in, fps), frames_to_tc(src_out, fps),
            frames_to_tc(rec, fps), frames_to_tc(rec_out, fps),
            clip
        ));
        if !t.note.trim().is_empty() {
            let note: String = t.note.chars().take(200).collect();
            out.push_str(&format!("* COMMENT: {}\n", note.replace('\n', " ")));
        }
        rec = rec_out;
        events += 1;
    }
    std::fs::write(path, out).map_err(|e| e.to_string())?;
    Ok((events, skipped))
}

// ---------- PDF daily log (pure Rust, embedded Inter = full Unicode) ----------

fn trunc(s: &str, n: usize) -> String {
    let c: String = s.replace('\n', " ").chars().take(n).collect();
    c
}

struct PdfPage {
    page: printpdf::PdfPageIndex,
    layer: printpdf::PdfLayerIndex,
    y: f32,
}

pub fn write_pdf(
    path: &str,
    film: &str,
    director: &str,
    location: &str,
    day: i64,
    scenes: &[Scene],
    takes: &[TakeWithScene],
) -> Result<(), String> {
    use std::io::BufWriter;
    let (doc, p1, l1) = PdfDocument::new(format!("{film} — Day {day} log"), Mm(297.0), Mm(210.0), "Layer 1");
    let font = doc.add_external_font(&mut std::io::Cursor::new(INTER)).map_err(|e| e.to_string())?;
    let bold = doc.add_external_font(&mut std::io::Cursor::new(INTER_BOLD)).map_err(|e| e.to_string())?;
    // Landscape A4, 12mm margins.
    let (pw, top, bottom, left) = (297.0, 198.0, 12.0, 12.0);
    let mut pg = PdfPage { page: p1, layer: l1, y: top };
    let need_page = |doc: &printpdf::PdfDocumentReference, pg: &mut PdfPage| {
        if pg.y < bottom + 14.0 {
            let (p, l) = doc.add_page(Mm(pw), Mm(210.0), "Layer");
            pg.page = p;
            pg.layer = l;
            pg.y = top;
        }
    };
    let line = |doc: &printpdf::PdfDocumentReference, pg: &mut PdfPage, text: &str, size: f32, b: bool, gap: f32| {
        need_page(doc, pg);
        let layer = doc.get_page(pg.page).get_layer(pg.layer);
        layer.use_text(text, size, Mm(left), Mm(pg.y), if b { &bold } else { &font });
        pg.y -= gap;
    };
    let date = chrono::Local::now().format("%d %b %Y").to_string();
    line(&doc, &mut pg, &format!("{film} — Daily log, Day {day}"), 17.0, true, 8.0);
    let mut sub = date.clone();
    if !director.trim().is_empty() {
        sub.push_str(&format!(" · Dir. {}", director.trim()));
    }
    if !location.trim().is_empty() {
        sub.push_str(&format!(" · {}", location.trim()));
    }
    line(&doc, &mut pg, &sub, 10.0, false, 4.0);
    let good = takes.iter().filter(|t| t.rating == "Good").count();
    let done = scenes.iter().filter(|s| s.status == "Complete").count();
    line(
        &doc, &mut pg,
        &format!("{} takes · {} good · {} scenes ({} complete)", takes.len(), good, scenes.len(), done),
        10.0, false, 8.0,
    );
    // Takes table. x positions across 273mm.
    let xs = [12.0, 26.0, 58.0, 72.0, 96.0, 122.0, 140.0, 162.0, 186.0];
    let heads = ["Scene", "Setup", "Take", "TC In", "Dur", "Cam", "Lens", "Rating", "Note"];
    let draw_row = |doc: &printpdf::PdfDocumentReference, pg: &mut PdfPage, cells: &[String], b: bool, font: &printpdf::IndirectFontRef, bold: &printpdf::IndirectFontRef| {
        need_page(doc, pg);
        let layer = doc.get_page(pg.page).get_layer(pg.layer);
        for (i, c) in cells.iter().enumerate() {
            layer.use_text(c, 8.5, Mm(xs[i]), Mm(pg.y), if b { bold } else { font });
        }
        pg.y -= 5.5;
    };
    let head_cells: Vec<String> = heads.iter().map(|s| s.to_string()).collect();
    draw_row(&doc, &mut pg, &head_cells, true, &font, &bold);
    pg.y -= 2.0;
    for t in takes {
        let dur = if t.duration_sec > 0.0 { format!("{:.0}s", t.duration_sec) } else { "—".to_string() };
        draw_row(
            &doc, &mut pg,
            &[
                trunc(&t.scene_number, 8),
                trunc(&t.setup_name, 14),
                format!("{:02}", t.take_no),
                trunc(&t.tc_in, 10),
                dur,
                trunc(&t.cam, 14),
                trunc(&t.lens, 8),
                trunc(&t.rating, 7),
                trunc(if t.note.is_empty() { &t.tags } else { &t.note }, 64),
            ].iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            false, &font, &bold,
        );
    }
    pg.y -= 6.0;
    line(&doc, &mut pg, "Scenes", 13.0, true, 7.0);
    for s in scenes {
        let n = takes.iter().filter(|t| t.scene_id == s.id).count();
        line(
            &doc, &mut pg,
            &format!("{} · {} — {} · {} takes", trunc(&s.number, 8), trunc(&s.title, 50), s.status, n),
            9.5, false, 5.5,
        );
    }
    doc.save(&mut BufWriter::new(std::fs::File::create(path).map_err(|e| e.to_string())?))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn write_take_row(
    ws: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    scene: &Scene,
    t: &TakeWithScene,
    wrap: &Format,
) -> Result<(), String> {
    let ie = if t.int_ext.is_empty() { &scene.int_ext } else { &t.int_ext };
    let day = if t.day == 0 { scene.day } else { t.day };
    ws.write_string(row, 0, &scene.number).map_err(|e| e.to_string())?;
    ws.write_string(row, 1, &t.setup_name).map_err(|e| e.to_string())?;
    ws.write_string(row, 2, &scene.title).map_err(|e| e.to_string())?;
    ws.write_string(row, 3, &scene.location).map_err(|e| e.to_string())?;
    ws.write_number(row, 4, day as f64).map_err(|e| e.to_string())?;
    ws.write_string(row, 5, ie).map_err(|e| e.to_string())?;
    ws.write_number(row, 6, t.take_no as f64).map_err(|e| e.to_string())?;
    ws.write_string(row, 7, &t.tc_in).map_err(|e| e.to_string())?;
    ws.write_string(row, 8, &t.cam).map_err(|e| e.to_string())?;
    ws.write_string(row, 9, &t.lens).map_err(|e| e.to_string())?;
    ws.write_string(row, 10, &t.cam_file).map_err(|e| e.to_string())?;
    ws.write_string(row, 11, &t.audio_file).map_err(|e| e.to_string())?;
    ws.write_string(row, 12, &t.rating).map_err(|e| e.to_string())?;
    ws.write_string(row, 13, &t.tags).map_err(|e| e.to_string())?;
    ws.write_string_with_format(row, 14, &t.note, wrap)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Writes All Takes (+ Good Selects + Days when enabled). Returns Ok(()) on success.
pub fn write_workbook(
    path: &str,
    scenes: &[Scene],
    takes_by_scene: &[(Scene, Vec<TakeWithScene>)],
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
    let headers = ["Scene", "Setup", "Title", "Location", "Day", "INT/EXT", "Take", "TC In", "Cam", "Lens", "Camera file", "Audio file", "Rating", "Quick notes", "Description"];
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
