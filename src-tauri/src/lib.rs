pub mod db;
pub mod export;
pub mod net;
pub mod script;

use db::{NewProject, NewScene, NewTake, Project, Scene, Setup, Take, TakeWithScene, UpdateTake};
use tauri::{AppHandle, Manager};

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    db::fetch_projects(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_project(app: AppHandle, project: NewProject) -> Result<Project, String> {
    if project.film_name.trim().is_empty() {
        return Err("Film name is required".into());
    }
    db::insert_project(&app, project).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_project(app: AppHandle, id: i64, project: NewProject) -> Result<(), String> {
    db::update_project(&app, id, project).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project(app: AppHandle, id: i64) -> Result<(), String> {
    db::remove_project(&app, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn duplicate_project(app: AppHandle, id: i64) -> Result<Project, String> {
    db::duplicate_project(&app, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_scenes(app: AppHandle, project_id: i64) -> Result<Vec<Scene>, String> {
    db::fetch_scenes(&app, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_scene(app: AppHandle, project_id: i64, scene: NewScene) -> Result<Scene, String> {
    db::insert_scene(&app, project_id, scene).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_takes(app: AppHandle, scene_id: i64) -> Result<Vec<Take>, String> {
    db::fetch_takes(&app, scene_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_project_takes(app: AppHandle, project_id: i64) -> Result<Vec<TakeWithScene>, String> {
    db::fetch_project_takes(&app, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_project_day(app: AppHandle, id: i64, day: i64) -> Result<(), String> {
    db::set_project_day(&app, id, day).map_err(|e| e.to_string())
}

#[tauri::command]
fn next_take(app: AppHandle, scene_id: i64) -> Result<i64, String> {
    db::next_take_no(&app, scene_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn log_take(app: AppHandle, take: NewTake) -> Result<Take, String> {
    if !["Bad", "Maybe", "Good"].contains(&take.rating.as_str()) {
        return Err("Rating must be Bad, Maybe or Good".into());
    }
    db::insert_take(&app, take).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_take(app: AppHandle, take_id: i64) -> Result<(), String> {
    db::remove_take(&app, take_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_take(app: AppHandle, id: i64, take: UpdateTake) -> Result<(), String> {
    if !["Bad", "Maybe", "Good"].contains(&take.rating.as_str()) {
        return Err("Rating must be Bad, Maybe or Good".into());
    }
    db::update_take(&app, id, take).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_scene(app: AppHandle, id: i64, scene: NewScene) -> Result<(), String> {
    db::update_scene(&app, id, scene).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_scene(app: AppHandle, id: i64) -> Result<(), String> {
    db::remove_scene(&app, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_setups(app: AppHandle, scene_id: i64) -> Result<Vec<Setup>, String> {
    db::fetch_setups(&app, scene_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_setup(app: AppHandle, scene_id: i64, name: String) -> Result<Setup, String> {
    db::insert_setup(&app, scene_id, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_setup(app: AppHandle, id: i64) -> Result<(), String> {
    db::remove_setup(&app, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_photos(app: AppHandle, scene_id: i64) -> Result<Vec<db::Photo>, String> {
    db::fetch_photos(&app, scene_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_photo(app: AppHandle, scene_id: i64, setup_id: Option<i64>) -> Result<db::Photo, String> {
    use tauri_plugin_dialog::FilePath;
    let app2 = app.clone();
    let picked: Option<FilePath> = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();
        app2.dialog()
            .file()
            .add_filter("Images", &["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif", "heic", "heif"])
            .pick_file(move |p| {
                let _ = tx.send(p);
            });
        rx.recv().unwrap_or(None)
    })
    .await
    .map_err(|e| e.to_string())?;
    let path = match picked {
        Some(FilePath::Path(p)) => p,
        Some(_) => return Err("Only local files can be imported".into()),
        None => return Err("cancelled".into()),
    };
    db::import_photo(&app, scene_id, setup_id, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn photo_data(app: AppHandle, id: i64, thumb: bool) -> Result<String, String> {
    db::photo_data_url(&app, id, thumb).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_photo_caption(app: AppHandle, id: i64, caption: String) -> Result<(), String> {
    db::update_photo_caption(&app, id, caption).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_photo(app: AppHandle, id: i64) -> Result<(), String> {
    db::remove_photo(&app, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_pdf(app: AppHandle, project_id: i64, day: i64) -> Result<String, String> {
    let projects = db::fetch_projects(&app).map_err(|e| e.to_string())?;
    let proj = projects
        .iter()
        .find(|p| p.id == project_id)
        .cloned()
        .ok_or("project not found")?;
    let scenes: Vec<Scene> = db::fetch_scenes(&app, project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|s| s.day == day)
        .collect();
    let all = db::fetch_project_takes(&app, project_id).map_err(|e| e.to_string())?;
    let takes: Vec<TakeWithScene> = all.into_iter().filter(|t| t.day == day).collect();
    let docs = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let stem: String = proj
        .film_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .collect::<String>()
        .replace(' ', "-");
    let stem = if stem.is_empty() { "slate-log".to_string() } else { stem };
    let path = docs.join(format!("{stem}-day{day}-log.pdf"));
    export::write_pdf(&path.to_string_lossy(), &proj.film_name, &proj.director, &proj.location, day, &scenes, &takes)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_edl(app: AppHandle, project_id: i64) -> Result<serde_json::Value, String> {
    let projects = db::fetch_projects(&app).map_err(|e| e.to_string())?;
    let proj = projects
        .iter()
        .find(|p| p.id == project_id)
        .cloned()
        .ok_or("project not found")?;
    let all = db::fetch_project_takes(&app, project_id).map_err(|e| e.to_string())?;
    let docs = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let stem: String = proj
        .film_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .collect::<String>()
        .replace(' ', "-");
    let stem = if stem.is_empty() { "slate-log".to_string() } else { stem };
    let path = docs.join(format!("{stem}-selects.edl"));
    let (events, skipped) = export::write_edl(&path.to_string_lossy(), &stem, proj.fps, &all)?;
    Ok(serde_json::json!({ "path": path.to_string_lossy(), "events": events, "skipped": skipped }))
}

fn col_index(header: &[String], names: &[&str]) -> Option<usize> {
    header
        .iter()
        .position(|h| {
            let n: String = h.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
            names.iter().any(|w| &n == w)
        })
}

#[tauri::command]
async fn import_scenes_csv(app: AppHandle, project_id: i64) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::FilePath;
    // Never open a blocking dialog on the command thread itself: AppKit
    // requires the dialog on the main thread, so hop via spawn_blocking.
    // (The old blocking_pick_file call crashed the app here.)
    let app2 = app.clone();
    let picked: Option<FilePath> = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();
        app2.dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .pick_file(move |p| {
                let _ = tx.send(p);
            });
        rx.recv().unwrap_or(None)
    })
    .await
    .map_err(|e| e.to_string())?;
    let path = match picked {
        Some(p) => p,
        None => return Ok(serde_json::json!({ "cancelled": true })),
    };
    let fs_path = match path {
        FilePath::Path(p) => p,
        _ => return Err("Only local files can be imported".into()),
    };
    let text = std::fs::read_to_string(&fs_path).map_err(|e| e.to_string())?;
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let rows: Vec<Vec<String>> = rdr
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| r.iter().map(|s| s.trim().to_string()).collect())
        .collect();
    if rows.is_empty() {
        return Err("CSV is empty".into());
    }
    // Header detection: first row names columns, otherwise positional.
    let looks_like_header = rows[0].iter().any(|c| {
        matches!(
            c.to_lowercase().as_str(),
            "number" | "no" | "scene" | "title" | "name" | "slug"
        )
    });
    let (header, data): (Vec<String>, &[Vec<String>]) = if looks_like_header {
        (rows[0].clone(), &rows[1..])
    } else {
        (
            vec!["number", "title", "int_ext", "daypart", "day", "location", "description", "camera"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            &rows[..],
        )
    };
    let ci = |names: &[&str], fallback: usize| col_index(&header, names).unwrap_or(fallback);
    let (i_num, i_title, i_ie, i_dp, i_day, i_loc, i_desc, i_cam) = (
        ci(&["number", "no", "scene", "sceneno"], 0),
        ci(&["title", "name", "slug"], 1),
        ci(&["intext", "intext", "int"], 2),
        ci(&["daypart", "daypart", "time"], 3),
        ci(&["day", "shootday"], 4),
        ci(&["location", "loc", "set"], 5),
        ci(&["description", "desc", "action"], 6),
        ci(&["camera", "cam", "cameradefault"], 7),
    );
    let cell = |row: &[String], i: usize| row.get(i).cloned().unwrap_or_default();
    let norm_ie = |v: &str| {
        if v.to_lowercase().starts_with('e') {
            "EXT".to_string()
        } else {
            "INT".to_string()
        }
    };
    let norm_dp = |v: &str| match v.to_lowercase().as_str() {
        "dusk" => "Dusk".to_string(),
        "night" => "Night".to_string(),
        "dawn" => "Dawn".to_string(),
        _ => "Day".to_string(),
    };
    let (mut imported, mut duplicates, mut skipped) = (0, 0, 0);
    for row in data {
        let number = cell(row, i_num);
        if number.is_empty() {
            skipped += 1;
            continue;
        }
        let scene = db::NewScene {
            number: number.clone(),
            title: cell(row, i_title),
            int_ext: norm_ie(&cell(row, i_ie)),
            daypart: norm_dp(&cell(row, i_dp)),
            day: cell(row, i_day).parse().unwrap_or(1).max(1),
            location: cell(row, i_loc),
            status: "Not shot".to_string(),
            description: cell(row, i_desc),
            camera_default: cell(row, i_cam),
        };
        match db::insert_scene(&app, project_id, scene) {
            Ok(_) => imported += 1,
            Err(e) if e.to_string().contains("already exists") => duplicates += 1,
            Err(_) => skipped += 1,
        }
    }
    Ok(serde_json::json!({ "cancelled": false, "imported": imported, "duplicates": duplicates, "skipped": skipped }))
}

#[tauri::command]
async fn import_screenplay_pdf(app: AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::FilePath;
    let app2 = app.clone();
    let picked: Option<FilePath> = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();
        app2.dialog()
            .file()
            .add_filter("Screenplay", &["pdf"])
            .pick_file(move |p| {
                let _ = tx.send(p);
            });
        rx.recv().unwrap_or(None)
    })
    .await
    .map_err(|e| e.to_string())?;
    let path = match picked {
        Some(FilePath::Path(p)) => p,
        Some(_) => return Err("Only local files can be imported".into()),
        None => return Ok(serde_json::json!({ "cancelled": true })),
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > 50_000_000 {
        return Err("PDF is too large (50MB max)".into());
    }
    let text = extract_script_text(&path, &bytes)?;
    if text.trim().len() < 50 {
        return Err("No readable text found — scanned/image PDFs need OCR first, or paste the text below".into());
    }
    let (scenes, warnings) = script::parse_screenplay(&text);
    if scenes.is_empty() {
        return Err("No scene headings found (looked for INT./EXT. slugs) — or paste the text below".into());
    }
    Ok(serde_json::json!({ "cancelled": false, "scenes": scenes, "warnings": warnings }))
}

/// PDF text the tolerant way: macOS Quartz (via textutil) reads the
/// malformed files strict parsers reject; pdf-extract covers the rest;
/// raw stream scraping is the last resort for broken xrefs.
fn extract_script_text(path: &std::path::Path, bytes: &[u8]) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("/usr/bin/textutil")
            .args(["-convert", "txt", "-stdout", "-encoding", "UTF-8"])
            .arg(path)
            .output()
        {
            if out.status.success() {
                let t = String::from_utf8_lossy(&out.stdout).to_string();
                if t.trim().len() >= 50 {
                    return Ok(t);
                }
            }
        }
    }
    if let Ok(t) = pdf_extract::extract_text_from_mem(bytes) {
        if t.trim().len() >= 50 {
            return Ok(t);
        }
    }
    // Last resort: inflate raw content streams even when the xref is broken.
    let raw = script::extract_raw_text(bytes);
    if raw.trim().len() >= 50 {
        return Ok(raw);
    }
    Err("No readable text found — scanned/image PDFs need OCR first, or paste the text below".to_string())
}

#[tauri::command]
fn parse_screenplay_text(text: String) -> Result<serde_json::Value, String> {
    if text.trim().len() < 10 {
        return Err("paste some script text first".into());
    }
    let (scenes, warnings) = script::parse_screenplay(&text);
    if scenes.is_empty() {
        return Err("No scene headings found (looked for INT./EXT. slugs)".into());
    }
    Ok(serde_json::json!({ "cancelled": false, "scenes": scenes, "warnings": warnings }))
}

#[derive(Debug, serde::Deserialize)]
struct ScriptSceneIn {
    number: String,
    title: String,
    int_ext: String,
    daypart: String,
    location: String,
    #[serde(default)]
    setups: Vec<String>,
}

#[tauri::command]
fn import_parsed_scenes(app: AppHandle, project_id: i64, scenes: Vec<ScriptSceneIn>) -> Result<serde_json::Value, String> {
    let norm_ie = |v: &str| {
        if v.to_lowercase().starts_with('e') { "EXT".to_string() } else { "INT".to_string() }
    };
    let norm_dp = |v: &str| match v {
        "Dusk" | "Night" | "Dawn" => v.to_string(),
        _ => "Day".to_string(),
    };
    let (mut imported, mut duplicates, mut skipped, mut setups) = (0, 0, 0, 0);
    for s in scenes {
        if s.number.trim().is_empty() {
            skipped += 1;
            continue;
        }
        let scene = db::NewScene {
            number: s.number.trim().to_string(),
            title: s.title.trim().to_string(),
            int_ext: norm_ie(&s.int_ext),
            daypart: norm_dp(&s.daypart),
            day: 1,
            location: s.location.trim().to_string(),
            status: "Not shot".to_string(),
            description: String::new(),
            camera_default: String::new(),
        };
        match db::insert_scene(&app, project_id, scene) {
            Ok(created) => {
                imported += 1;
                for name in s.setups {
                    if db::insert_setup(&app, created.id, name).is_ok() {
                        setups += 1;
                    }
                }
            }
            Err(e) if e.to_string().contains("already exists") => duplicates += 1,
            Err(_) => skipped += 1,
        }
    }
    Ok(serde_json::json!({ "imported": imported, "duplicates": duplicates, "skipped": skipped, "setups": setups }))
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    match update {
        Some(u) => Ok(serde_json::json!({ "available": true, "version": u.version, "notes": u.body.clone().unwrap_or_default() })),
        None => Ok(serde_json::json!({ "available": false })),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("no update available")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn get_stats(app: AppHandle, project_id: Option<i64>) -> Result<serde_json::Value, String> {
    let (total, goods) = db::stats(&app, project_id).map_err(|e| e.to_string())?;
    let rate = if total == 0 { 0 } else { goods * 100 / total };
    Ok(serde_json::json!({ "total": total, "goods": goods, "prints": goods, "good_rate": rate, "print_rate": rate }))
}

#[tauri::command]
fn photo_counts(app: AppHandle, project_id: i64) -> Result<Vec<db::ScenePhotoCount>, String> {
    db::photo_counts_for_project(&app, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_all_scene_cameras(app: AppHandle, project_id: i64, camera: String) -> Result<serde_json::Value, String> {
    let cam = camera.trim().to_string();
    if cam.is_empty() {
        return Err("Camera is empty".into());
    }
    let n = db::set_all_scene_cameras(&app, project_id, cam).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "updated": n }))
}

#[tauri::command]
async fn pick_stage_poster(app: AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::FilePath;
    let app2 = app.clone();
    let picked: Option<FilePath> = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();
        app2.dialog()
            .file()
            .add_filter("Images", &["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif"])
            .pick_file(move |p| {
                let _ = tx.send(p);
            });
        rx.recv().unwrap_or(None)
    })
    .await
    .map_err(|e| e.to_string())?;
    let path = match picked {
        Some(FilePath::Path(p)) => p,
        Some(_) => return Err("Only local files can be used".into()),
        None => return Ok(serde_json::json!({ "cancelled": true })),
    };
    let key = db::stage_poster_file(path).map_err(|e| {
        e.to_string().replace("Invalid parameter name: ", "")
    })?;
    Ok(serde_json::json!({ "cancelled": false, "key": key }))
}

#[tauri::command]
fn staged_poster_data(key: String) -> Result<String, String> {
    db::staged_poster_data_url(&key)
        .map_err(|e| e.to_string().replace("Invalid parameter name: ", ""))
}

#[tauri::command]
fn project_poster_data(app: AppHandle, project_id: i64) -> Result<String, String> {
    db::poster_data_url(&app, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_project_poster(app: AppHandle, project_id: i64) -> Result<(), String> {
    db::remove_poster(&app, project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_project_photos(app: AppHandle, project_id: Option<i64>) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = db::photos_folder(&app, project_id).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn undo_delete(app: AppHandle) -> Result<db::UndoResult, String> {
    db::undo_last_delete(&app).map_err(|e| {
        let m = e.to_string();
        // Strip rusqlite prefix for the toast.
        m.replace("Invalid parameter name: ", "")
    })
}

#[tauri::command]
fn export_excel(
    app: AppHandle,
    project_id: i64,
    include_good: Option<bool>,
    include_days: Option<bool>,
) -> Result<String, String> {
    let projects = db::fetch_projects(&app).map_err(|e| e.to_string())?;
    let proj = projects.iter().find(|p| p.id == project_id).cloned();
    let scenes = db::fetch_scenes(&app, project_id).map_err(|e| e.to_string())?;
    let all = db::fetch_project_takes(&app, project_id).map_err(|e| e.to_string())?;
    let mut grouped: Vec<(Scene, Vec<TakeWithScene>)> = Vec::new();
    for s in &scenes {
        let takes: Vec<TakeWithScene> = all.iter().filter(|t| t.scene_id == s.id).cloned().collect();
        grouped.push((s.clone(), takes));
    }
    // Always the user's Documents folder; filename derived from the film name
    // (sanitized) so the frontend can never steer writes anywhere else.
    let docs = app.path().document_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let stem = proj
        .map(|p| p.film_name.chars().filter(|c| c.is_alphanumeric() || *c == ' ').collect::<String>().replace(' ', "-"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "slate-log".into());
    let fname = format!("{}-{}.xlsx", stem, chrono::Local::now().format("%Y%m%d-%H%M"));
    let path = docs.join(fname).to_string_lossy().to_string();
    let photo_labels = db::photo_labels_for_project(&app, project_id).unwrap_or_default();
    export::write_workbook(
        &path,
        &scenes,
        &grouped,
        &photo_labels,
        include_good.unwrap_or(true),
        include_days.unwrap_or(true),
    )?;
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(net::SetMode::new())
        .setup(|app| {
            let handle = app.handle().clone();
            db::ensure_schema(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            update_project,
            delete_project,
            duplicate_project,
            set_project_day,
            list_scenes,
            create_scene,
            update_scene,
            delete_scene,
            list_setups,
            create_setup,
            delete_setup,
            list_photos,
            add_photo,
            photo_data,
            update_photo_caption,
            delete_photo,
            export_pdf,
            export_edl,
            import_scenes_csv,
            import_screenplay_pdf,
            parse_screenplay_text,
            import_parsed_scenes,
            list_takes,
            list_project_takes,
            next_take,
            log_take,
            update_take,
            delete_take,
            get_stats,
            export_excel,
            photo_counts,
            set_all_scene_cameras,
            pick_stage_poster,
            staged_poster_data,
            project_poster_data,
            remove_project_poster,
            open_project_photos,
            undo_delete,
            app_version,
            check_update,
            install_update,
            net::set_start,
            net::set_stop,
            net::set_scene,
            net::set_info,
            net::set_qr,
        ])
        .run(tauri::generate_context!())
        .expect("error while running slate-log");
}
