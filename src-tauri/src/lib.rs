pub mod db;
pub mod export;

use db::{NewProject, NewScene, NewTake, Project, Scene, Take, TakeWithScene, UpdateTake};
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
fn get_stats(app: AppHandle, project_id: Option<i64>) -> Result<serde_json::Value, String> {
    let (total, goods) = db::stats(&app, project_id).map_err(|e| e.to_string())?;
    let rate = if total == 0 { 0 } else { goods * 100 / total };
    Ok(serde_json::json!({ "total": total, "goods": goods, "prints": goods, "good_rate": rate, "print_rate": rate }))
}

#[tauri::command]
fn export_excel(
    app: AppHandle,
    project_id: i64,
    save_path: Option<String>,
    include_good: Option<bool>,
    include_days: Option<bool>,
) -> Result<String, String> {
    let projects = db::fetch_projects(&app).map_err(|e| e.to_string())?;
    let proj = projects.iter().find(|p| p.id == project_id).cloned();
    let scenes = db::fetch_scenes(&app, project_id).map_err(|e| e.to_string())?;
    let mut grouped: Vec<(Scene, Vec<Take>)> = Vec::new();
    for s in &scenes {
        let takes = db::fetch_takes(&app, s.id).map_err(|e| e.to_string())?;
        grouped.push((s.clone(), takes));
    }
    let path = if let Some(p) = save_path {
        p
    } else {
        let docs = app.path().document_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let stem = proj
            .map(|p| p.film_name.chars().filter(|c| c.is_alphanumeric() || *c == ' ').collect::<String>().replace(' ', "-"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "slate-log".into());
        let fname = format!("{}-{}.xlsx", stem, chrono::Local::now().format("%Y%m%d-%H%M"));
        docs.join(fname).to_string_lossy().to_string()
    };
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
        .plugin(tauri_plugin_fs::init())
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
