pub mod db;
pub mod export;

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
fn write_template_csv(app: AppHandle) -> Result<String, String> {
    let docs = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let path = docs.join("slate-log-template.csv");
    let template = "number,title,int_ext,daypart,day,location,description,camera\n\
                    14,Abandoned lift station,INT,Day,4,Lift station,Wide push through the rusted gate,A · Sony FX6\n\
                    15,Engineer interview,INT,Day,4,,Seated interview 35mm,B · Sony FX3\n";
    std::fs::write(&path, template).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_stats(app: AppHandle, project_id: Option<i64>) -> Result<serde_json::Value, String> {
    let (total, goods) = db::stats(&app, project_id).map_err(|e| e.to_string())?;
    let rate = if total == 0 { 0 } else { goods * 100 / total };
    Ok(serde_json::json!({ "total": total, "goods": goods, "prints": goods, "good_rate": rate, "print_rate": rate }))
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
    export::write_workbook(
        &path,
        &scenes,
        &grouped,
        include_good.unwrap_or(true),
        include_days.unwrap_or(true),
    )?;
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            import_scenes_csv,
            write_template_csv,
            list_takes,
            list_project_takes,
            next_take,
            log_take,
            update_take,
            delete_take,
            get_stats,
            export_excel
        ])
        .run(tauri::generate_context!())
        .expect("error while running slate-log");
}
