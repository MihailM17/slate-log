use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ---------- Models ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub film_name: String,
    pub director: String,
    pub camera_op: String,
    pub location: String,
    pub unit: String,
    pub shoot_day: i64,
    pub total_days: i64,
    pub fps: f64,
    pub camera_a: String,
    pub camera_b: String,
    #[serde(default)]
    pub poster: String,
    pub scene_count: i64,
    pub take_count: i64,
    pub good_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewProject {
    pub film_name: String,
    pub director: String,
    pub camera_op: String,
    pub location: String,
    pub unit: String,
    pub shoot_day: i64,
    pub total_days: i64,
    pub fps: f64,
    pub camera_a: String,
    pub camera_b: String,
    /// Staged poster key from pick_stage_poster (attached on save). Absent = keep.
    #[serde(default)]
    pub poster_stage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: i64,
    pub project_id: i64,
    pub number: String,
    pub title: String,
    pub int_ext: String,
    pub daypart: String,
    pub day: i64,
    pub location: String,
    pub status: String, // "Not shot" | "Partial" | "Complete"
    pub description: String,
    pub camera_default: String,
    pub take_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Take {
    pub id: i64,
    pub scene_id: i64,
    pub take_no: i64,
    pub tc_in: String,
    pub cam: String,
    pub lens: String,
    pub rating: String, // "Bad" | "Maybe" | "Good"
    pub int_ext: String,
    pub day: i64,
    pub duration_sec: f64,
    pub cam_file: String,
    pub audio_file: String,
    pub setup_id: Option<i64>,
    pub tags: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TakeWithScene {
    pub id: i64,
    pub scene_id: i64,
    pub scene_number: String,
    pub scene_title: String,
    pub take_no: i64,
    pub tc_in: String,
    pub cam: String,
    pub lens: String,
    pub rating: String,
    pub int_ext: String,
    pub day: i64,
    pub duration_sec: f64,
    pub cam_file: String,
    pub audio_file: String,
    pub setup_id: Option<i64>,
    pub setup_name: String,
    pub tags: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Setup {
    pub id: i64,
    pub scene_id: i64,
    pub name: String,
    pub take_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub id: i64,
    pub scene_id: i64,
    pub setup_id: Option<i64>,
    pub setup_name: String,
    pub filename: String,
    pub caption: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct NewScene {
    pub number: String,
    pub title: String,
    pub int_ext: String,
    pub daypart: String,
    pub day: i64,
    pub location: String,
    pub status: String,
    pub description: String,
    pub camera_default: String,
}

#[derive(Debug, Deserialize)]
pub struct NewTake {
    pub scene_id: i64,
    pub tc_in: String,
    pub cam: String,
    pub lens: String,
    pub rating: String,
    pub int_ext: String,
    pub day: i64,
    pub duration_sec: f64,
    pub cam_file: String,
    pub audio_file: String,
    pub setup_id: Option<i64>,
    pub tags: String,
    pub note: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTake {
    pub tc_in: String,
    pub cam: String,
    pub lens: String,
    pub rating: String,
    pub int_ext: String,
    pub day: i64,
    pub duration_sec: f64,
    pub cam_file: String,
    pub audio_file: String,
    pub setup_id: Option<i64>,
    pub tags: String,
    pub note: String,
}

// ---------- DB helpers ----------

pub fn db_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&dir).ok();
    dir.join("slate-log.db")
}

fn connect(app: &AppHandle) -> rusqlite::Result<Connection> {
    let path = db_path(app);
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS projects (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           film_name TEXT NOT NULL DEFAULT '',
           director TEXT NOT NULL DEFAULT '',
           camera_op TEXT NOT NULL DEFAULT '',
           location TEXT NOT NULL DEFAULT '',
           unit TEXT NOT NULL DEFAULT '',
           shoot_day INTEGER NOT NULL DEFAULT 1,
           total_days INTEGER NOT NULL DEFAULT 1,
           fps REAL NOT NULL DEFAULT 25,
           camera_a TEXT NOT NULL DEFAULT '',
           camera_b TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
         );
         CREATE TABLE IF NOT EXISTS scenes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           project_id INTEGER NOT NULL DEFAULT 0,
           number TEXT NOT NULL DEFAULT '',
           title TEXT NOT NULL DEFAULT '',
           int_ext TEXT NOT NULL DEFAULT 'INT',
           daypart TEXT NOT NULL DEFAULT 'Day',
           day INTEGER NOT NULL DEFAULT 1,
           location TEXT NOT NULL DEFAULT '',
           description TEXT NOT NULL DEFAULT '',
           camera_default TEXT NOT NULL DEFAULT ''
         );
         CREATE TABLE IF NOT EXISTS takes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
           take_no INTEGER NOT NULL,
           tc_in TEXT NOT NULL DEFAULT '',
           cam TEXT NOT NULL DEFAULT '',
           lens TEXT NOT NULL DEFAULT '35mm',
           rating TEXT NOT NULL DEFAULT 'Bad',
           int_ext TEXT NOT NULL DEFAULT '',
           day INTEGER NOT NULL DEFAULT 1,
           duration_sec REAL NOT NULL DEFAULT 0,
           cam_file TEXT NOT NULL DEFAULT '',
           audio_file TEXT NOT NULL DEFAULT '',
           tags TEXT NOT NULL DEFAULT '',
           note TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
           UNIQUE(scene_id, take_no)
         );
         CREATE TABLE IF NOT EXISTS settings (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL DEFAULT ''
         );
         CREATE TABLE IF NOT EXISTS setups (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
           name TEXT NOT NULL DEFAULT '',
           UNIQUE(scene_id, name)
         );
         CREATE TABLE IF NOT EXISTS photos (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
           setup_id INTEGER,
           filename TEXT NOT NULL DEFAULT '',
           caption TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
         );",
    )?;
    // Idempotent migrations for DBs created by older versions
    let _ = conn.execute("ALTER TABLE scenes ADD COLUMN project_id INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE takes ADD COLUMN int_ext TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE scenes ADD COLUMN day INTEGER NOT NULL DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE takes ADD COLUMN day INTEGER NOT NULL DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE scenes ADD COLUMN location TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE takes ADD COLUMN cam_file TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE takes ADD COLUMN audio_file TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE scenes ADD COLUMN status TEXT NOT NULL DEFAULT 'Not shot'", []);
    let _ = conn.execute("ALTER TABLE takes ADD COLUMN setup_id INTEGER", []);
    let _ = conn.execute("ALTER TABLE takes ADD COLUMN duration_sec REAL NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE projects ADD COLUMN fps REAL NOT NULL DEFAULT 25", []);
    let _ = conn.execute("ALTER TABLE projects ADD COLUMN poster TEXT NOT NULL DEFAULT ''", []);
    // One "14" per project. May fail on DBs that already contain duplicates
    // from the unconstrained era - the app-level checks below still guard
    // all new writes either way.
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_project_number ON scenes(project_id, number)",
        [],
    );
    // Rating rename: NG -> Bad, Hold -> Maybe, Print -> Good
    let _ = conn.execute("UPDATE takes SET rating='Bad' WHERE rating='NG'", []);
    let _ = conn.execute("UPDATE takes SET rating='Maybe' WHERE rating='Hold'", []);
    let _ = conn.execute("UPDATE takes SET rating='Good' WHERE rating='Print'", []);
    // Adopt orphan scenes (pre-projects) into a migrated project built from legacy settings
    migrate_orphans(&conn)?;
    Ok(conn)
}

fn legacy_setting(conn: &Connection, key: &str, fallback: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|_| fallback.to_string())
}

fn migrate_orphans(conn: &Connection) -> rusqlite::Result<()> {
    let orphans: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scenes WHERE project_id=0 OR project_id IS NULL",
        [],
        |r| r.get(0),
    )?;
    if orphans == 0 {
        return Ok(());
    }
    let existing: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?;
    let pid: i64 = if existing == 0 {
        let film = legacy_setting(conn, "film_name", "");
        let loc = legacy_setting(conn, "location", "");
        let unit = legacy_setting(conn, "unit", "");
        let day: i64 = legacy_setting(conn, "shoot_day", "1").parse().unwrap_or(1);
        let total: i64 = legacy_setting(conn, "total_days", "1").parse().unwrap_or(1);
        let ca = legacy_setting(conn, "camera_a", "");
        let cb = legacy_setting(conn, "camera_b", "");
        // Only create the migration project if there is actually something to keep.
        // Fresh installs have zero scenes, so this is a no-op and the app starts empty.
        if film.is_empty() && loc.is_empty() && ca.is_empty() {
            return Ok(());
        }
        conn.execute(
            "INSERT INTO projects (film_name, director, camera_op, location, unit, shoot_day, total_days, camera_a, camera_b) VALUES (?,?,?,?,?,?,?,?,?)",
            params![film, "", "", loc, unit, day, total, ca, cb],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.query_row("SELECT id FROM projects ORDER BY id LIMIT 1", [], |r| r.get(0))?
    };
    conn.execute("UPDATE scenes SET project_id=?1 WHERE project_id=0 OR project_id IS NULL", params![pid])?;
    Ok(())
}

pub fn ensure_schema(app: &AppHandle) {
    // Back up first so a failed migration can never eat the shoot.
    backup_db(app);
    // Reload trash so Ctrl+Z survives restarts.
    load_trash(app);
    if let Ok(conn) = connect(app) {
        // Touch tables so fresh installs start with empty projects/scenes.
        let _ : rusqlite::Result<i64> = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0));
    }
}

/// Timestamped copy of the database on every launch; keeps the newest 10.
/// Lives next to the live DB: <app_data>/backups/slate-log-YYYYMMDD-HHMMSS.db
pub fn backup_db(app: &AppHandle) {
    let path = db_path(app);
    let Ok(meta) = std::fs::metadata(&path) else { return };
    if meta.len() == 0 {
        return;
    }
    let dir = path.parent().map(|p| p.join("backups")).unwrap_or_else(|| PathBuf::from("backups"));
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = dir.join(format!("slate-log-{stamp}.db"));
    if std::fs::copy(&path, &dest).is_err() {
        return;
    }
    // Prune oldest, keep 10.
    if let Ok(files) = std::fs::read_dir(&dir) {
        let mut names: Vec<String> = files
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("slate-log-") && n.ends_with(".db"))
            .collect();
        names.sort();
        for old in names.iter().take(names.len().saturating_sub(10)) {
            let _ = std::fs::remove_file(dir.join(old));
        }
    }
}

// ---------- Projects ----------

pub fn fetch_projects(app: &AppHandle) -> rusqlite::Result<Vec<Project>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.film_name, p.director, p.camera_op, p.location, p.unit, p.shoot_day, p.total_days, p.fps, p.camera_a, p.camera_b, p.poster,
                (SELECT COUNT(*) FROM scenes s WHERE s.project_id=p.id) AS sc,
                (SELECT COUNT(*) FROM takes t JOIN scenes s ON s.id=t.scene_id WHERE s.project_id=p.id) AS tc,
                (SELECT COUNT(*) FROM takes t JOIN scenes s ON s.id=t.scene_id WHERE s.project_id=p.id AND t.rating='Good') AS gc
         FROM projects p ORDER BY p.id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Project {
            id: r.get(0)?,
            film_name: r.get(1)?,
            director: r.get(2)?,
            camera_op: r.get(3)?,
            location: r.get(4)?,
            unit: r.get(5)?,
            shoot_day: r.get(6)?,
            total_days: r.get(7)?,
            fps: r.get(8).unwrap_or(25.0),
            camera_a: r.get(9)?,
            camera_b: r.get(10)?,
            poster: r.get(11).unwrap_or_default(),
            scene_count: r.get(12)?,
            take_count: r.get(13)?,
            good_count: r.get(14)?,
        })
    })?;
    rows.collect()
}

fn valid_fps(f: f64) -> f64 {
    if f > 0.0 && f < 1000.0 {
        f
    } else {
        25.0
    }
}

pub fn insert_project(app: &AppHandle, p: NewProject) -> rusqlite::Result<Project> {
    let conn = connect(app)?;
    let fps = valid_fps(p.fps);
    conn.execute(
        "INSERT INTO projects (film_name, director, camera_op, location, unit, shoot_day, total_days, fps, camera_a, camera_b) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params![p.film_name, p.director, p.camera_op, p.location, p.unit, p.shoot_day, p.total_days, fps, p.camera_a, p.camera_b],
    )?;
    let id = conn.last_insert_rowid();
    let mut poster = String::new();
    if let Some(key) = p.poster_stage {
        if let Ok(name) = attach_staged_poster(app, &conn, id, &key) {
            poster = name;
        }
    }
    Ok(Project { id, film_name: p.film_name, director: p.director, camera_op: p.camera_op, location: p.location, unit: p.unit, shoot_day: p.shoot_day, total_days: p.total_days, fps, camera_a: p.camera_a, camera_b: p.camera_b, poster, scene_count: 0, take_count: 0, good_count: 0 })
}

pub fn update_project(app: &AppHandle, id: i64, p: NewProject) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    let fps = valid_fps(p.fps);
    conn.execute(
        "UPDATE projects SET film_name=?1, director=?2, camera_op=?3, location=?4, unit=?5, shoot_day=?6, total_days=?7, fps=?8, camera_a=?9, camera_b=?10 WHERE id=?11",
        params![p.film_name, p.director, p.camera_op, p.location, p.unit, p.shoot_day, p.total_days, fps, p.camera_a, p.camera_b, id],
    )?;
    if let Some(key) = p.poster_stage {
        let _ = attach_staged_poster(app, &conn, id, &key);
    }
    Ok(())
}

pub fn remove_project(app: &AppHandle, id: i64) -> rusqlite::Result<()> {
    if let Some(bundle) = capture_project_bundle(app, id) {
        push_undo_persistent(app, UndoItem::Project(bundle));
    }
    let conn = connect(app)?;
    // Drop photo files first (rows go with the scenes below).
    let scene_ids: Vec<i64> = conn
        .prepare("SELECT id FROM scenes WHERE project_id=?1")
        .and_then(|mut s| {
            s.query_map(params![id], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<i64>>>()
        })
        .unwrap_or_default();
    for sid in scene_ids {
        delete_scene_photos(app, &conn, sid, id);
    }
    let dir = photos_dir(app, id);
    let _ = std::fs::remove_dir_all(dir);
    delete_poster_files(app, id);
    conn.execute("DELETE FROM takes WHERE scene_id IN (SELECT id FROM scenes WHERE project_id=?1)", params![id])?;
    conn.execute("DELETE FROM setups WHERE scene_id IN (SELECT id FROM scenes WHERE project_id=?1)", params![id])?;
    conn.execute("DELETE FROM scenes WHERE project_id=?1", params![id])?;
    conn.execute("DELETE FROM projects WHERE id=?1", params![id])?;
    Ok(())
}

pub fn duplicate_project(app: &AppHandle, id: i64) -> rusqlite::Result<Project> {
    let conn = connect(app)?;
    let src: NewProject = conn.query_row(
        "SELECT film_name, director, camera_op, location, unit, shoot_day, total_days, fps, camera_a, camera_b FROM projects WHERE id=?1",
        params![id],
        |r| {
            Ok(NewProject {
                film_name: r.get(0)?, director: r.get(1)?, camera_op: r.get(2)?,
                location: r.get(3)?, unit: r.get(4)?, shoot_day: r.get(5)?,
                total_days: r.get(6)?, fps: r.get(7).unwrap_or(25.0), camera_a: r.get(8)?, camera_b: r.get(9)?,
                poster_stage: None,
            })
        },
    )?;
    let src_poster: String = conn.query_row("SELECT poster FROM projects WHERE id=?1", params![id], |r| r.get(0)).unwrap_or_default();
    let name = format!("Copy of {}", src.film_name);
    let fps = valid_fps(src.fps);
    conn.execute(
        "INSERT INTO projects (film_name, director, camera_op, location, unit, shoot_day, total_days, fps, camera_a, camera_b) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params![name, src.director, src.camera_op, src.location, src.unit, src.shoot_day, src.total_days, fps, src.camera_a, src.camera_b],
    )?;
    let new_pid = conn.last_insert_rowid();
    let mut new_poster = String::new();
    if !src_poster.is_empty() {
        new_poster = copy_poster_file(app, id, new_pid).unwrap_or_default();
        if !new_poster.is_empty() {
            let _ = conn.execute("UPDATE projects SET poster=?1 WHERE id=?2", params![new_poster, new_pid]);
        }
    }
    // Copy scenes, remembering old -> new ids for setups and takes.
    let mut stmt = conn.prepare(
        "SELECT id, number, title, int_ext, daypart, day, location, status, description, camera_default FROM scenes WHERE project_id=?1",
    )?;
    let old_scenes: Vec<(i64, String, String, String, String, i64, String, String, String, String)> = stmt
        .query_map(params![id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    for (old_sid, number, title, int_ext, daypart, day, location, status, description, camera_default) in old_scenes {
        conn.execute(
            "INSERT INTO scenes (project_id, number, title, int_ext, daypart, day, location, status, description, camera_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![new_pid, number, title, int_ext, daypart, day, location, status, description, camera_default],
        )?;
        let new_sid = conn.last_insert_rowid();
        // Copy setups with old -> new id map for the takes.
        let mut ustmt = conn.prepare("SELECT id, name FROM setups WHERE scene_id=?1")?;
        let old_setups: Vec<(i64, String)> = ustmt
            .query_map(params![old_sid], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(ustmt);
        let mut setup_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
        for (old_uid, name) in old_setups {
            conn.execute("INSERT INTO setups (scene_id, name) VALUES (?,?)", params![new_sid, name])?;
            setup_map.insert(old_uid, conn.last_insert_rowid());
        }
        // Copy takes one by one to remap setup ids.
        let mut tstmt = conn.prepare(
            "SELECT take_no, tc_in, cam, lens, rating, int_ext, day, duration_sec, cam_file, audio_file, setup_id, tags, note, created_at FROM takes WHERE scene_id=?1",
        )?;
        let old_takes: Vec<(i64, String, String, String, String, String, i64, f64, String, String, Option<i64>, String, String, String)> = tstmt
            .query_map(params![old_sid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(tstmt);
        for (take_no, tc_in, cam, lens, rating, int_ext, tday, dur, cam_file, audio_file, setup_id, tags, note, created_at) in old_takes {
            let new_setup = setup_id.and_then(|s| setup_map.get(&s).copied());
            conn.execute(
                "INSERT INTO takes (scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, duration_sec, cam_file, audio_file, setup_id, tags, note, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                params![new_sid, take_no, tc_in, cam, lens, rating, int_ext, tday, dur, cam_file, audio_file, new_setup, tags, note, created_at],
            )?;
        }
        // Copy continuity stills with remapped setups.
        let mut pstmt = conn.prepare(
            "SELECT setup_id, filename, caption, created_at FROM photos WHERE scene_id=?1",
        )?;
        let old_photos: Vec<(Option<i64>, String, String, String)> = pstmt
            .query_map(params![old_sid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(pstmt);
        let new_dir = photos_dir(app, new_pid);
        let new_thumbs = new_dir.join("thumbs");
        let _ = std::fs::create_dir_all(&new_thumbs);
        for (old_setup, filename, caption, created_at) in old_photos {
            let new_setup = old_setup.and_then(|s| setup_map.get(&s).copied());
            let stem = unique_stem() + "_copy";
            let ext = filename.rsplit_once('.').map(|(_, e)| e).unwrap_or("jpg");
            let new_name = format!("{stem}.{ext}");
            let (old_full, old_th) = photo_files(app, id, &filename);
            let _ = std::fs::copy(&old_full, new_dir.join(&new_name));
            let _ = std::fs::copy(&old_th, new_thumbs.join(format!("{stem}_thumb.jpg")));
            conn.execute(
                "INSERT INTO photos (scene_id, setup_id, filename, caption, created_at) VALUES (?,?,?,?,?)",
                params![new_sid, new_setup, new_name, caption, created_at],
            )?;
        }
    }
    Ok(Project {
        id: new_pid, film_name: name, director: src.director, camera_op: src.camera_op,
        location: src.location, unit: src.unit, shoot_day: src.shoot_day, total_days: src.total_days,
        fps, camera_a: src.camera_a, camera_b: src.camera_b, poster: new_poster, scene_count: 0, take_count: 0, good_count: 0,
    })
}

// ---------- Scenes ----------

pub fn fetch_scenes(app: &AppHandle, project_id: i64) -> rusqlite::Result<Vec<Scene>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.project_id, s.number, s.title, s.int_ext, s.daypart, s.day, s.location, s.status, s.description, s.camera_default,
                (SELECT COUNT(*) FROM takes t WHERE t.scene_id = s.id) AS take_count
         FROM scenes s WHERE s.project_id=?1 ORDER BY CAST(s.number AS INTEGER), s.number",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(Scene {
            id: r.get(0)?,
            project_id: r.get(1)?,
            number: r.get(2)?,
            title: r.get(3)?,
            int_ext: r.get(4)?,
            daypart: r.get(5)?,
            day: r.get(6)?,
            location: r.get(7).unwrap_or_default(),
            status: r.get(8).unwrap_or_else(|_| "Not shot".to_string()),
            description: r.get(9)?,
            camera_default: r.get(10)?,
            take_count: r.get(11)?,
        })
    })?;
    rows.collect()
}

/// Single scene by id (used by set mode + dup helpers).
pub fn fetch_scenes_for(app: &AppHandle, id: i64) -> Option<Scene> {
    let conn = connect(app).ok()?;
    conn.query_row(
        "SELECT s.id, s.project_id, s.number, s.title, s.int_ext, s.daypart, s.day, s.location, s.status, s.description, s.camera_default,
                (SELECT COUNT(*) FROM takes t WHERE t.scene_id = s.id)
         FROM scenes s WHERE s.id=?1",
        params![id],
        |r| {
            Ok(Scene {
                id: r.get(0)?,
                project_id: r.get(1)?,
                number: r.get(2)?,
                title: r.get(3)?,
                int_ext: r.get(4)?,
                daypart: r.get(5)?,
                day: r.get(6)?,
                location: r.get(7).unwrap_or_default(),
                status: r.get(8).unwrap_or_else(|_| "Not shot".to_string()),
                description: r.get(9)?,
                camera_default: r.get(10)?,
                take_count: r.get(11)?,
            })
        },
    )
    .ok()
}

fn scene_number_taken(conn: &Connection, project_id: i64, number: &str, except_id: Option<i64>) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM scenes WHERE project_id=?1 AND number=?2 AND (?3 IS NULL OR id != ?3)",
        params![project_id, number, except_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .unwrap_or(false)
}

fn valid_status(s: &str) -> String {
    match s {
        "Partial" => "Partial".to_string(),
        "Complete" => "Complete".to_string(),
        _ => "Not shot".to_string(),
    }
}

pub fn insert_scene(app: &AppHandle, project_id: i64, s: NewScene) -> rusqlite::Result<Scene> {
    let conn = connect(app)?;
    if scene_number_taken(&conn, project_id, &s.number, None) {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE),
            Some(format!("Scene {} already exists in this project", s.number)),
        ));
    }
    let status = valid_status(&s.status);
    conn.execute(
        "INSERT INTO scenes (project_id, number, title, int_ext, daypart, day, location, status, description, camera_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params![project_id, s.number, s.title, s.int_ext, s.daypart, s.day, s.location, status, s.description, s.camera_default],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Scene { id, project_id, number: s.number, title: s.title, int_ext: s.int_ext, daypart: s.daypart, day: s.day, location: s.location, status, description: s.description, camera_default: s.camera_default, take_count: 0 })
}

pub fn update_scene(app: &AppHandle, id: i64, s: NewScene) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    let project_id: i64 = conn.query_row("SELECT project_id FROM scenes WHERE id=?1", params![id], |r| r.get(0))?;
    if scene_number_taken(&conn, project_id, &s.number, Some(id)) {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE),
            Some(format!("Scene {} already exists in this project", s.number)),
        ));
    }    let status = valid_status(&s.status);
    conn.execute(
        "UPDATE scenes SET number=?1, title=?2, int_ext=?3, daypart=?4, day=?5, location=?6, status=?7, description=?8, camera_default=?9 WHERE id=?10",
        params![s.number, s.title, s.int_ext, s.daypart, s.day, s.location, status, s.description, s.camera_default, id],
    )?;
    Ok(())
}

pub fn remove_scene(app: &AppHandle, id: i64) -> rusqlite::Result<()> {
    // Snapshot for Ctrl+Z before anything is destroyed.
    if let Some(bundle) = capture_scene_bundle(app, id) {
        push_undo_persistent(app, UndoItem::Scene(bundle));
    }
    let conn = connect(app)?;
    let project_id: i64 = conn.query_row("SELECT project_id FROM scenes WHERE id=?1", params![id], |r| r.get(0)).unwrap_or(0);
    delete_scene_photos(app, &conn, id, project_id);
    conn.execute("DELETE FROM takes WHERE scene_id=?1", params![id])?;
    conn.execute("DELETE FROM setups WHERE scene_id=?1", params![id])?;
    conn.execute("DELETE FROM scenes WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- Setups ----------

pub fn fetch_setups(app: &AppHandle, scene_id: i64) -> rusqlite::Result<Vec<Setup>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT u.id, u.scene_id, u.name,
                (SELECT COUNT(*) FROM takes t WHERE t.setup_id = u.id) AS take_count
         FROM setups u WHERE u.scene_id=?1 ORDER BY u.id",
    )?;
    let rows = stmt.query_map(params![scene_id], |r| {
        Ok(Setup { id: r.get(0)?, scene_id: r.get(1)?, name: r.get(2)?, take_count: r.get(3)? })
    })?;
    rows.collect()
}

pub fn insert_setup(app: &AppHandle, scene_id: i64, name: String) -> rusqlite::Result<Setup> {
    let conn = connect(app)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName("setup name is required".into()));
    }
    conn.execute(
        "INSERT INTO setups (scene_id, name) VALUES (?,?)",
        params![scene_id, name],
    )
    .map_err(|e| {
        // UNIQUE(scene_id, name) violation -> friendly message
        if e.to_string().contains("UNIQUE") {
            rusqlite::Error::InvalidParameterName(format!("Setup “{name}” already exists in this scene"))
        } else {
            e
        }
    })?;
    let id = conn.last_insert_rowid();
    Ok(Setup { id, scene_id, name, take_count: 0 })
}

pub fn remove_setup(app: &AppHandle, id: i64) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    // Takes stay, they just lose their setup tag.
    conn.execute("UPDATE takes SET setup_id=NULL WHERE setup_id=?1", params![id])?;
    conn.execute("UPDATE photos SET setup_id=NULL WHERE setup_id=?1", params![id])?;
    conn.execute("DELETE FROM setups WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- Photos (continuity stills, stored locally) ----------

fn photos_dir(app: &AppHandle, project_id: i64) -> PathBuf {
    photos_root(app).join(project_id.to_string())
}

fn photos_root(app: &AppHandle) -> PathBuf {
    let dir = db_path(app);
    let base = dir.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    base.join("photos")
}

/// Photo folder for a project (or the shared root when none is open).
/// Created on demand so there is always something to reveal.
pub fn photos_folder(app: &AppHandle, project_id: Option<i64>) -> rusqlite::Result<PathBuf> {
    let dir = match project_id {
        Some(pid) => photos_dir(app, pid),
        None => photos_root(app),
    };
    std::fs::create_dir_all(&dir).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    Ok(dir)
}

fn photo_project_of(conn: &Connection, scene_id: i64) -> rusqlite::Result<i64> {
    conn.query_row("SELECT project_id FROM scenes WHERE id=?1", params![scene_id], |r| r.get(0))
}

pub fn fetch_photos(app: &AppHandle, scene_id: i64) -> rusqlite::Result<Vec<Photo>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.scene_id, p.setup_id, COALESCE(su.name,''), p.filename, p.caption, p.created_at
         FROM photos p LEFT JOIN setups su ON su.id = p.setup_id
         WHERE p.scene_id=?1 ORDER BY p.id",
    )?;
    let rows = stmt.query_map(params![scene_id], |r| {
        Ok(Photo {
            id: r.get(0)?, scene_id: r.get(1)?,
            setup_id: r.get(2).unwrap_or(None), setup_name: r.get(3)?,
            filename: r.get(4)?, caption: r.get(5)?, created_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

fn unique_stem() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}")
}

pub fn import_photo(app: &AppHandle, scene_id: i64, setup_id: Option<i64>, src: PathBuf) -> rusqlite::Result<Photo> {
    let conn = connect(app)?;
    let project_id = photo_project_of(&conn, scene_id)?;
    if let Some(sid) = setup_id {
        if !setup_belongs(&conn, sid, scene_id) {
            return Err(rusqlite::Error::InvalidParameterName("setup does not belong to this scene".into()));
        }
    }
    // Decode from bytes (magic-number sniffing), never from the file
    // extension — uploads arrive as .tmp and phones send all sorts of names.
    let src_ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    // iPhones set to High Efficiency send HEIC, which no pure-Rust decoder
    // reads — on macOS the system converter handles it, elsewhere we say so.
    let _heic_tmp: Option<PathBuf>;
    let decode_src: PathBuf = if src_ext == "heic" || src_ext == "heif" {
        #[cfg(target_os = "macos")]
        {
            let out = std::env::temp_dir().join(format!("slate-heic-{}.jpg", unique_stem()));
            let st = std::process::Command::new("sips")
                .args(["-s", "format", "jpeg"])
                .arg(&src)
                .arg("--out")
                .arg(&out)
                .output()
                .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
            if !st.status.success() {
                return Err(rusqlite::Error::InvalidParameterName(
                    "could not convert that HEIC photo — set the camera to JPEG".to_string(),
                ));
            }
            _heic_tmp = Some(out.clone());
            out
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = _heic_tmp;
            return Err(rusqlite::Error::InvalidParameterName(
                "HEIC photos convert on macOS only — set the camera to JPEG".to_string(),
            ));
        }
    } else {
        _heic_tmp = None;
        src.clone()
    };
    let bytes = std::fs::read(&decode_src).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    let fmt = image::guess_format(&bytes).map_err(|_| {
        rusqlite::Error::InvalidParameterName(
            "photo must be a JPEG, PNG, WebP or GIF image (HEIC is not supported - set the camera to JPEG)".to_string(),
        )
    })?;
    let img = image::load_from_memory_with_format(&bytes, fmt).map_err(|_| {
        rusqlite::Error::InvalidParameterName("could not decode that photo - try JPEG".to_string())
    })?;
    // The stored file is always decoded pixels: HEIC arrives converted.
    let is_heic = src_ext == "heic" || src_ext == "heif";
    let ext = if is_heic {
        "jpg".to_string()
    } else {
        decode_src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .filter(|e| ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif"].contains(&e.as_str()))
            .unwrap_or_else(|| "jpg".to_string())
    };
    let store_src = if is_heic { decode_src.clone() } else { src.clone() };
    let dir = photos_dir(app, project_id);
    let thumbs = dir.join("thumbs");
    std::fs::create_dir_all(&thumbs).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    let stem = unique_stem();
    let filename = format!("{stem}.{ext}");
    let dest = dir.join(&filename);
    std::fs::copy(&store_src, &dest).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    if is_heic {
        // Converted temp, not the user's file — always safe to remove.
        let _ = std::fs::remove_file(&decode_src);
    }
    // 480px thumbnail for grids + contact sheets; full file kept for lightbox.
    let thumb = img.thumbnail(480, 480);
    let thumb_name = format!("{stem}_thumb.jpg");
    if thumb.save_with_format(thumbs.join(&thumb_name), image::ImageFormat::Jpeg).is_err() {
        let _ = std::fs::remove_file(&dest);
        return Err(rusqlite::Error::InvalidParameterName("could not thumbnail image".into()));
    }
    conn.execute(
        "INSERT INTO photos (scene_id, setup_id, filename, caption) VALUES (?,?,?,?)",
        params![scene_id, setup_id, filename, ""],
    )?;
    let id = conn.last_insert_rowid();
    let created: String = conn.query_row("SELECT created_at FROM photos WHERE id=?1", params![id], |r| r.get(0))?;
    let setup_name: String = match setup_id {
        Some(sid) => conn.query_row("SELECT name FROM setups WHERE id=?1", params![sid], |r| r.get(0)).unwrap_or_default(),
        None => String::new(),
    };
    Ok(Photo { id, scene_id, setup_id, setup_name, filename, caption: String::new(), created_at: created })
}

fn photo_files(app: &AppHandle, project_id: i64, filename: &str) -> (PathBuf, PathBuf) {
    let dir = photos_dir(app, project_id);
    let stem = filename.rsplit_once('.').map(|(s, _)| s).unwrap_or(filename);
    (dir.join(filename), dir.join("thumbs").join(format!("{stem}_thumb.jpg")))
}

pub fn photo_data_url(app: &AppHandle, id: i64, thumb: bool) -> rusqlite::Result<String> {
    let conn = connect(app)?;
    let (scene_id, filename): (i64, String) = conn.query_row(
        "SELECT scene_id, filename FROM photos WHERE id=?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let project_id = photo_project_of(&conn, scene_id)?;
    let (full, th) = photo_files(app, project_id, &filename);
    let path = if thumb { th } else { full };
    let bytes = std::fs::read(&path).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    let mime = if thumb {
        "image/jpeg"
    } else if filename.to_lowercase().ends_with(".png") {
        "image/png"
    } else if filename.to_lowercase().ends_with(".webp") {
        "image/webp"
    } else if filename.to_lowercase().ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    };
    use base64::Engine as _;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

pub fn update_photo_caption(app: &AppHandle, id: i64, caption: String) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    conn.execute("UPDATE photos SET caption=?1 WHERE id=?2", params![caption, id])?;
    Ok(())
}

pub fn remove_photo(app: &AppHandle, id: i64) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    let (scene_id, filename): (i64, String) = conn.query_row(
        "SELECT scene_id, filename FROM photos WHERE id=?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let project_id = photo_project_of(&conn, scene_id).unwrap_or(0);
    conn.execute("DELETE FROM photos WHERE id=?1", params![id])?;
    let (full, th) = photo_files(app, project_id, &filename);
    let _ = std::fs::remove_file(full);
    let _ = std::fs::remove_file(th);
    Ok(())
}

fn delete_scene_photos(app: &AppHandle, conn: &Connection, scene_id: i64, project_id: i64) {
    let files: Vec<String> = conn
        .prepare("SELECT filename FROM photos WHERE scene_id=?1")
        .and_then(|mut s| {
            s.query_map(params![scene_id], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()
        })
        .unwrap_or_default();
    let _ = conn.execute("DELETE FROM photos WHERE scene_id=?1", params![scene_id]);
    for f in files {
        let (full, th) = photo_files(app, project_id, &f);
        let _ = std::fs::remove_file(full);
        let _ = std::fs::remove_file(th);
    }
}

// ---------- Takes ----------

pub fn fetch_takes(app: &AppHandle, scene_id: i64) -> rusqlite::Result<Vec<Take>> {
    let conn = connect(app)?;
    // connect() always runs the int_ext/day migrations first, so the column exists.
    let mut stmt = conn.prepare(
        "SELECT id, scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, duration_sec, cam_file, audio_file, setup_id, tags, note, created_at FROM takes WHERE scene_id=?1 ORDER BY take_no",
    )?;
    let rows = stmt.query_map(params![scene_id], |r| {
        Ok(Take {
            id: r.get(0)?, scene_id: r.get(1)?, take_no: r.get(2)?, tc_in: r.get(3)?,
            cam: r.get(4)?, lens: r.get(5)?, rating: r.get(6)?, int_ext: r.get(7)?,
            day: r.get(8).unwrap_or(1), duration_sec: r.get(9).unwrap_or(0.0),
            cam_file: r.get(10).unwrap_or_default(), audio_file: r.get(11).unwrap_or_default(),
            setup_id: r.get(12).unwrap_or(None),
            tags: r.get(13)?, note: r.get(14)?, created_at: r.get(15)?,
        })
    })?;
    rows.collect()
}

pub fn next_take_no(app: &AppHandle, scene_id: i64) -> rusqlite::Result<i64> {
    let conn = connect(app)?;
    let max: Option<i64> = conn
        .query_row("SELECT MAX(take_no) FROM takes WHERE scene_id=?1", params![scene_id], |r| r.get(0))
        .optional()?
        .flatten();
    Ok(max.unwrap_or(0) + 1)
}

fn setup_belongs(conn: &Connection, setup_id: i64, scene_id: i64) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM setups WHERE id=?1 AND scene_id=?2",
        params![setup_id, scene_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .unwrap_or(false)
}

pub fn insert_take(app: &AppHandle, t: NewTake) -> rusqlite::Result<Take> {
    let conn = connect(app)?;
    if let Some(sid) = t.setup_id {
        if !setup_belongs(&conn, sid, t.scene_id) {
            return Err(rusqlite::Error::InvalidParameterName("setup does not belong to this scene".into()));
        }
    }
    let no: i64 = conn.query_row(
        "SELECT COALESCE(MAX(take_no),0)+1 FROM takes WHERE scene_id=?1",
        params![t.scene_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO takes (scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, duration_sec, cam_file, audio_file, setup_id, tags, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![t.scene_id, no, t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.duration_sec.max(0.0), t.cam_file, t.audio_file, t.setup_id, t.tags, t.note],
    )?;
    let id = conn.last_insert_rowid();
    let created: String = conn.query_row("SELECT created_at FROM takes WHERE id=?1", params![id], |r| r.get(0))?;
    Ok(Take { id, scene_id: t.scene_id, take_no: no, tc_in: t.tc_in, cam: t.cam, lens: t.lens, rating: t.rating, int_ext: t.int_ext, day: t.day, duration_sec: t.duration_sec.max(0.0), cam_file: t.cam_file, audio_file: t.audio_file, setup_id: t.setup_id, tags: t.tags, note: t.note, created_at: created })
}

pub fn remove_take(app: &AppHandle, take_id: i64) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    conn.execute("DELETE FROM takes WHERE id=?1", params![take_id])?;
    Ok(())
}

pub fn update_take(app: &AppHandle, id: i64, t: UpdateTake) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    let scene_id: i64 = conn.query_row("SELECT scene_id FROM takes WHERE id=?1", params![id], |r| r.get(0))?;
    if let Some(sid) = t.setup_id {
        if !setup_belongs(&conn, sid, scene_id) {
            return Err(rusqlite::Error::InvalidParameterName("setup does not belong to this scene".into()));
        }
    }
    conn.execute(
        "UPDATE takes SET tc_in=?1, cam=?2, lens=?3, rating=?4, int_ext=?5, day=?6, duration_sec=?7, cam_file=?8, audio_file=?9, setup_id=?10, tags=?11, note=?12 WHERE id=?13",
        params![t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.duration_sec.max(0.0), t.cam_file, t.audio_file, t.setup_id, t.tags, t.note, id],
    )?;
    Ok(())
}

pub fn set_project_day(app: &AppHandle, id: i64, day: i64) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    conn.execute(
        "UPDATE projects SET shoot_day = CASE WHEN ?1 < 1 THEN 1 ELSE ?1 END WHERE id=?2",
        params![day, id],
    )?;
    Ok(())
}

pub fn fetch_project_takes(app: &AppHandle, project_id: i64) -> rusqlite::Result<Vec<TakeWithScene>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.scene_id, s.number, s.title, t.take_no, t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.duration_sec, t.cam_file, t.audio_file, t.setup_id, su.name, t.tags, t.note, t.created_at
         FROM takes t JOIN scenes s ON s.id = t.scene_id LEFT JOIN setups su ON su.id = t.setup_id
         WHERE s.project_id = ?1
         ORDER BY CAST(s.number AS INTEGER), s.number, t.take_no",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(TakeWithScene {
            id: r.get(0)?, scene_id: r.get(1)?, scene_number: r.get(2)?, scene_title: r.get(3)?,
            take_no: r.get(4)?, tc_in: r.get(5)?, cam: r.get(6)?, lens: r.get(7)?,
            rating: r.get(8)?, int_ext: r.get(9)?, day: r.get(10)?, duration_sec: r.get(11).unwrap_or(0.0),
            cam_file: r.get(12)?, audio_file: r.get(13)?,
            setup_id: r.get(14).unwrap_or(None), setup_name: r.get(15).unwrap_or_default(),
            tags: r.get(16)?, note: r.get(17)?,
            created_at: r.get(18)?,
        })
    })?;
    rows.collect()
}

pub fn stats(app: &AppHandle, project_id: Option<i64>) -> rusqlite::Result<(i64, i64)> {
    let conn = connect(app)?;
    let (total, goods): (i64, i64) = match project_id {
        Some(pid) => {
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM takes t JOIN scenes s ON s.id=t.scene_id WHERE s.project_id=?1",
                params![pid], |r| r.get(0))?;
            let goods: i64 = conn.query_row(
                "SELECT COUNT(*) FROM takes t JOIN scenes s ON s.id=t.scene_id WHERE s.project_id=?1 AND t.rating='Good'",
                params![pid], |r| r.get(0))?;
            (total, goods)
        }
        None => {
            let total: i64 = conn.query_row("SELECT COUNT(*) FROM takes", [], |r| r.get(0))?;
            let goods: i64 = conn.query_row("SELECT COUNT(*) FROM takes WHERE rating='Good'", [], |r| r.get(0))?;
            (total, goods)
        }
    };
    Ok((total, goods))
}

// ---------- Photo counts for tables + Excel ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenePhotoCount {
    pub scene_id: i64,
    pub count: i64,
}

pub fn photo_counts_for_project(app: &AppHandle, project_id: i64) -> rusqlite::Result<Vec<ScenePhotoCount>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT p.scene_id, COUNT(*) FROM photos p JOIN scenes s ON s.id=p.scene_id WHERE s.project_id=?1 GROUP BY p.scene_id",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(ScenePhotoCount { scene_id: r.get(0)?, count: r.get(1)? })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoLabel {
    pub scene_id: i64,
    pub setup_id: Option<i64>,
    pub filename: String,
    pub caption: String,
}

pub fn photo_labels_for_project(app: &AppHandle, project_id: i64) -> rusqlite::Result<Vec<PhotoLabel>> {
    let conn = connect(app)?;
    let mut stmt = conn.prepare(
        "SELECT p.scene_id, p.setup_id, p.filename, p.caption FROM photos p JOIN scenes s ON s.id=p.scene_id WHERE s.project_id=?1 ORDER BY p.id",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(PhotoLabel { scene_id: r.get(0)?, setup_id: r.get(1).unwrap_or(None), filename: r.get(2)?, caption: r.get(3)? })
    })?;
    rows.collect()
}

// ---------- Project posters (one image per project, stored in app data) ----------

fn posters_dir(app: &AppHandle) -> PathBuf {
    let dir = db_path(app);
    let base = dir.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    base.join("posters")
}

fn poster_path(app: &AppHandle, project_id: i64) -> PathBuf {
    posters_dir(app).join(format!("{project_id}.jpg"))
}

fn delete_poster_files(app: &AppHandle, project_id: i64) {
    let _ = std::fs::remove_file(poster_path(app, project_id));
}

fn copy_poster_file(app: &AppHandle, from_id: i64, to_id: i64) -> rusqlite::Result<String> {
    let src = poster_path(app, from_id);
    if std::fs::metadata(&src).is_err() {
        return Ok(String::new());
    }
    let _ = std::fs::create_dir_all(posters_dir(app));
    std::fs::copy(&src, poster_path(app, to_id)).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    Ok(format!("{to_id}.jpg"))
}

/// Staged poster bytes picked from the file dialog, keyed until save.
fn poster_stage() -> &'static std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>> {
    static STAGE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>> =
        std::sync::OnceLock::new();
    STAGE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn stage_poster_bytes(jpg: Vec<u8>) -> String {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let key = format!(
        "{}-{}",
        unique_stem(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    if let Ok(mut m) = poster_stage().lock() {
        while m.len() > 10 {
            if let Some(k) = m.keys().next().cloned() {
                m.remove(&k);
            } else {
                break;
            }
        }
        m.insert(key.clone(), jpg);
    }
    key
}

/// Decode any common image, shrink to 960px wide, return JPEG bytes.
fn process_poster_bytes(raw: &[u8]) -> Result<Vec<u8>, String> {
    let fmt = image::guess_format(raw)
        .map_err(|_| "poster must be a JPEG, PNG, WebP or GIF image".to_string())?;
    let img = image::load_from_memory_with_format(raw, fmt)
        .map_err(|_| "could not decode that image — try JPEG or PNG".to_string())?;
    let img = if img.width() > 960 {
        img.resize(960, 960, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

pub fn stage_poster_file(src: PathBuf) -> rusqlite::Result<String> {
    let raw = std::fs::read(&src).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    if raw.len() > 25_000_000 {
        return Err(rusqlite::Error::InvalidParameterName("image is too large (25MB max)".into()));
    }
    let jpg = process_poster_bytes(&raw).map_err(rusqlite::Error::InvalidParameterName)?;
    Ok(stage_poster_bytes(jpg))
}

pub fn staged_poster_data_url(key: &str) -> rusqlite::Result<String> {
    let m = poster_stage()
        .lock()
        .map_err(|_| rusqlite::Error::InvalidParameterName("poster staging failed".into()))?;
    let bytes = m
        .get(key)
        .ok_or_else(|| rusqlite::Error::InvalidParameterName("staged poster expired — pick it again".into()))?;
    use base64::Engine as _;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn attach_staged_poster(app: &AppHandle, conn: &rusqlite::Connection, project_id: i64, key: &str) -> rusqlite::Result<String> {
    let bytes = poster_stage()
        .lock()
        .map_err(|_| rusqlite::Error::InvalidParameterName("poster staging failed".into()))?
        .remove(key)
        .ok_or_else(|| rusqlite::Error::InvalidParameterName("staged poster expired — pick it again".into()))?;
    let _ = std::fs::create_dir_all(posters_dir(app));
    std::fs::write(poster_path(app, project_id), &bytes)
        .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    let name = format!("{project_id}.jpg");
    conn.execute("UPDATE projects SET poster=?1 WHERE id=?2", params![name, project_id])?;
    Ok(name)
}

pub fn remove_poster(app: &AppHandle, project_id: i64) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    conn.execute("UPDATE projects SET poster='' WHERE id=?1", params![project_id])?;
    delete_poster_files(app, project_id);
    Ok(())
}

pub fn poster_data_url(app: &AppHandle, project_id: i64) -> rusqlite::Result<String> {
    let conn = connect(app)?;
    let name: String = conn
        .query_row("SELECT poster FROM projects WHERE id=?1", params![project_id], |r| {
            r.get(0)
        })
        .unwrap_or_default();
    if name.is_empty() {
        return Ok(String::new());
    }
    let bytes = std::fs::read(poster_path(app, project_id))
        .map_err(|_| rusqlite::Error::InvalidParameterName("poster file is missing".into()))?;
    use base64::Engine as _;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

// ---------- Bulk camera replace ----------

pub fn set_all_scene_cameras(app: &AppHandle, project_id: i64, camera: String) -> rusqlite::Result<i64> {
    let conn = connect(app)?;
    let n = conn.execute(
        "UPDATE scenes SET camera_default=?1 WHERE project_id=?2",
        params![camera, project_id],
    )?;
    Ok(n as i64)
}

// ---------- Undo (Ctrl+Z) for scene / project deletes ----------

/// Base64 for byte blobs: JSON arrays of numbers would bloat stills ~3x.
mod b64 {
    use base64::Engine as _;
    use serde::Deserialize;
    pub fn serialize<S: serde::Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(v))
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(d)?;
        base64::engine::general_purpose::STANDARD
            .decode(text)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct PhotoBackup {
    id: i64,
    scene_id: i64,
    setup_id: Option<i64>,
    filename: String,
    caption: String,
    created_at: String,
    #[serde(with = "b64")]
    full_bytes: Vec<u8>,
    #[serde(with = "b64")]
    thumb_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct SceneBundle {
    id: i64,
    project_id: i64,
    number: String,
    title: String,
    int_ext: String,
    daypart: String,
    day: i64,
    location: String,
    status: String,
    description: String,
    camera_default: String,
    takes: Vec<Take>,
    setups: Vec<Setup>,
    photos: Vec<PhotoBackup>,
    /// Disk key of the trash file (never serialized — it comes from the filename).
    #[serde(skip)]
    trash_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct ProjectBundle {
    id: i64,
    film_name: String,
    director: String,
    camera_op: String,
    location: String,
    unit: String,
    shoot_day: i64,
    total_days: i64,
    fps: f64,
    camera_a: String,
    camera_b: String,
    poster: String,
    #[serde(with = "b64")]
    poster_bytes: Vec<u8>,
    scenes: Vec<SceneBundle>,
    /// Disk key of the trash file (never serialized — it comes from the filename).
    #[serde(skip)]
    trash_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
enum UndoItem {
    Scene(SceneBundle),
    Project(ProjectBundle),
}

fn undo_stack() -> &'static std::sync::Mutex<Vec<UndoItem>> {
    static STACK: std::sync::OnceLock<std::sync::Mutex<Vec<UndoItem>>> = std::sync::OnceLock::new();
    STACK.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn push_undo(item: UndoItem) {
    if let Ok(mut s) = undo_stack().lock() {
        s.push(item);
        while s.len() > 20 {
            s.remove(0);
        }
    }
}

// ---------- Persistent trash: undo survives restarts ----------
//
// Every pushed bundle is also written to <app_data>/trash/ as one JSON file
// (stills/poster as base64). On launch the files are loaded back into the
// in-memory stack, so Ctrl+Z works across restarts. Newest 10 kept.

fn trash_dir(app: &AppHandle) -> PathBuf {
    let dir = db_path(app);
    let base = dir.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    base.join("trash")
}

fn trash_key_for(item: &UndoItem) -> String {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (kind, id) = match item {
        UndoItem::Scene(b) => ("scene", b.id),
        UndoItem::Project(b) => ("project", b.id),
    };
    format!(
        "{}-{}-{}-{}",
        unique_stem(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        kind,
        id
    )
}

fn trash_save(dir: &std::path::Path, item: &UndoItem) -> Option<String> {
    if std::fs::create_dir_all(dir).is_err() {
        return None;
    }
    let key = trash_key_for(item);
    let data = serde_json::to_vec(item).ok()?;
    std::fs::write(dir.join(format!("{key}.json")), data).ok()?;
    trash_prune(dir);
    Some(key)
}

fn trash_load(dir: &std::path::Path) -> Vec<(String, UndoItem)> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.ends_with(".json"))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    let mut out = Vec::new();
    for n in names {
        let key = n.trim_end_matches(".json").to_string();
        let item: Option<UndoItem> = std::fs::read(dir.join(&n))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        if let Some(item) = item {
            out.push((key, item));
        }
    }
    out
}

fn trash_remove(dir: &std::path::Path, key: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{key}.json")));
}

fn trash_prune(dir: &std::path::Path) {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.ends_with(".json"))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    while names.len() > 10 {
        let old = names.remove(0);
        let _ = std::fs::remove_file(dir.join(old));
    }
}

/// Push with a trash-file backup. A full disk never blocks the delete itself.
fn push_undo_persistent(app: &AppHandle, mut item: UndoItem) {
    let key = trash_save(&trash_dir(app), &item);
    match &mut item {
        UndoItem::Scene(b) => b.trash_key = key,
        UndoItem::Project(b) => b.trash_key = key,
    }
    push_undo(item);
}

/// Load trash files into the in-memory stack (called once at launch).
fn load_trash(app: &AppHandle) {
    let loaded = trash_load(&trash_dir(app));
    if loaded.is_empty() {
        return;
    }
    if let Ok(mut s) = undo_stack().lock() {
        for (key, mut item) in loaded {
            match &mut item {
                UndoItem::Scene(b) => b.trash_key = Some(key),
                UndoItem::Project(b) => b.trash_key = Some(key),
            }
            s.push(item);
            while s.len() > 20 {
                s.remove(0);
            }
        }
    }
}

fn backup_photo_files(app: &AppHandle, project_id: i64, meta: &Photo) -> (Vec<u8>, Vec<u8>) {
    let (full, th) = photo_files(app, project_id, &meta.filename);
    let full_b = std::fs::read(&full).unwrap_or_default();
    let th_b = std::fs::read(&th).unwrap_or_default();
    (full_b, th_b)
}

fn capture_scene_bundle(app: &AppHandle, scene_id: i64) -> Option<SceneBundle> {
    let sc = fetch_scenes_for(app, scene_id)?;
    let takes = fetch_takes(app, scene_id).unwrap_or_default();
    let setups = fetch_setups(app, scene_id).unwrap_or_default();
    let photos_meta = fetch_photos(app, scene_id).unwrap_or_default();
    let photos = photos_meta
        .iter()
        .map(|p| {
            let (full_b, th_b) = backup_photo_files(app, sc.project_id, p);
            PhotoBackup {
                id: p.id,
                scene_id: p.scene_id,
                setup_id: p.setup_id,
                filename: p.filename.clone(),
                caption: p.caption.clone(),
                created_at: p.created_at.clone(),
                full_bytes: full_b,
                thumb_bytes: th_b,
            }
        })
        .collect();
    Some(SceneBundle {
        id: sc.id,
        project_id: sc.project_id,
        number: sc.number,
        title: sc.title,
        int_ext: sc.int_ext,
        daypart: sc.daypart,
        day: sc.day,
        location: sc.location,
        status: sc.status,
        description: sc.description,
        camera_default: sc.camera_default,
        takes,
        setups,
        photos,
        trash_key: None,
    })
}

fn capture_project_bundle(app: &AppHandle, project_id: i64) -> Option<ProjectBundle> {
    let conn = connect(app).ok()?;
    let (film_name, director, camera_op, location, unit, shoot_day, total_days, fps, camera_a, camera_b, poster): (String, String, String, String, String, i64, i64, f64, String, String, String) =
        conn.query_row(
            "SELECT film_name, director, camera_op, location, unit, shoot_day, total_days, fps, camera_a, camera_b, poster FROM projects WHERE id=?1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7).unwrap_or(25.0), r.get(8)?, r.get(9)?, r.get(10).unwrap_or_default())),
        ).ok()?;
    let poster_bytes = if poster.is_empty() { Vec::new() } else { std::fs::read(poster_path(app, project_id)).unwrap_or_default() };
    let scenes = fetch_scenes(app, project_id).unwrap_or_default();
    let mut bundles = Vec::new();
    for s in scenes {
        if let Some(b) = capture_scene_bundle(app, s.id) {
            bundles.push(b);
        }
    }
    Some(ProjectBundle {
        id: project_id,
        film_name,
        director,
        camera_op,
        location,
        unit,
        shoot_day,
        total_days,
        fps,
        camera_a,
        camera_b,
        poster,
        poster_bytes,
        scenes: bundles,
        trash_key: None,
    })
}

fn restore_photo_files(app: &AppHandle, project_id: i64, p: &PhotoBackup) {
    if p.full_bytes.is_empty() {
        return;
    }
    let dir = photos_dir(app, project_id);
    let thumbs = dir.join("thumbs");
    let _ = std::fs::create_dir_all(&thumbs);
    let (full, th) = photo_files(app, project_id, &p.filename);
    let _ = std::fs::write(&full, &p.full_bytes);
    if !p.thumb_bytes.is_empty() {
        let _ = std::fs::write(&th, &p.thumb_bytes);
    }
}

fn insert_scene_bundle(conn: &rusqlite::Connection, app: &AppHandle, b: &SceneBundle) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO scenes (id, project_id, number, title, int_ext, daypart, day, location, status, description, camera_default) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        params![b.id, b.project_id, b.number, b.title, b.int_ext, b.daypart, b.day, b.location, b.status, b.description, b.camera_default],
    )?;
    for u in &b.setups {
        conn.execute(
            "INSERT INTO setups (id, scene_id, name) VALUES (?,?,?)",
            params![u.id, b.id, u.name],
        )?;
    }
    for t in &b.takes {
        conn.execute(
            "INSERT INTO takes (id, scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, duration_sec, cam_file, audio_file, setup_id, tags, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![t.id, b.id, t.take_no, t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.duration_sec, t.cam_file, t.audio_file, t.setup_id, t.tags, t.note, t.created_at],
        )?;
    }
    for p in &b.photos {
        conn.execute(
            "INSERT INTO photos (id, scene_id, setup_id, filename, caption, created_at) VALUES (?,?,?,?,?,?)",
            params![p.id, b.id, p.setup_id, p.filename, p.caption, p.created_at],
        )?;
        restore_photo_files(app, b.project_id, p);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoResult {
    pub message: String,
    pub kind: String,
    pub project_id: Option<i64>,
    pub scene_id: Option<i64>,
}

pub fn undo_last_delete(app: &AppHandle) -> rusqlite::Result<UndoResult> {
    let item = undo_stack().lock().map(|mut s| s.pop()).unwrap_or(None);
    let item = item.ok_or_else(|| rusqlite::Error::InvalidParameterName("nothing to undo".into()))?;
    let conn = connect(app)?;
    match item {
        UndoItem::Scene(b) => {
            // Project may be gone (deleted after) — refuse rather than orphan.
            let proj_exists: i64 = conn.query_row("SELECT COUNT(*) FROM projects WHERE id=?1", params![b.project_id], |r| r.get(0))?;
            if proj_exists == 0 {
                return Err(rusqlite::Error::InvalidParameterName("project is gone — cannot restore scene".into()));
            }
            if scene_number_taken(&conn, b.project_id, &b.number, None) {
                return Err(rusqlite::Error::InvalidParameterName(format!("cannot undo — scene {} already exists", b.number)));
            }
            insert_scene_bundle(&conn, app, &b)?;
            if let Some(key) = b.trash_key.as_deref() {
                trash_remove(&trash_dir(app), key);
            }
            Ok(UndoResult {
                message: format!("Scene {} restored", b.number),
                kind: "scene".to_string(),
                project_id: Some(b.project_id),
                scene_id: Some(b.id),
            })
        }
        UndoItem::Project(b) => {
            let exists: i64 = conn.query_row("SELECT COUNT(*) FROM projects WHERE id=?1", params![b.id], |r| r.get(0))?;
            if exists > 0 {
                return Err(rusqlite::Error::InvalidParameterName("project already exists — cannot undo".into()));
            }
            conn.execute(
                "INSERT INTO projects (id, film_name, director, camera_op, location, unit, shoot_day, total_days, fps, camera_a, camera_b, poster) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                params![b.id, b.film_name, b.director, b.camera_op, b.location, b.unit, b.shoot_day, b.total_days, b.fps, b.camera_a, b.camera_b, b.poster],
            )?;
            if !b.poster.is_empty() && !b.poster_bytes.is_empty() {
                let _ = std::fs::create_dir_all(posters_dir(app));
                let _ = std::fs::write(poster_path(app, b.id), &b.poster_bytes);
            }
            for s in &b.scenes {
                insert_scene_bundle(&conn, app, s)?;
            }
            if let Some(key) = b.trash_key.as_deref() {
                trash_remove(&trash_dir(app), key);
            }
            Ok(UndoResult {
                message: format!("Project “{}” restored", b.film_name),
                kind: "project".to_string(),
                project_id: Some(b.id),
                scene_id: None,
            })
        }
    }
}

pub fn undo_available() -> bool {
    undo_stack().lock().map(|s| !s.is_empty()).unwrap_or(false)
}

#[cfg(test)]
mod trash_tests {
    use super::*;

    fn temp_trash(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "slate-trash-test-{}-{}-{}",
            std::process::id(),
            unique_stem(),
            tag
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn sample_scene_bundle() -> SceneBundle {
        SceneBundle {
            id: 5,
            project_id: 1,
            number: "14".to_string(),
            title: "Meadow".to_string(),
            int_ext: "EXT".to_string(),
            daypart: "Day".to_string(),
            day: 2,
            location: "".to_string(),
            status: "Complete".to_string(),
            description: "".to_string(),
            camera_default: "A".to_string(),
            takes: vec![Take {
                id: 11, scene_id: 5, take_no: 3, tc_in: "10:00:00".to_string(),
                cam: "A".to_string(), lens: "35mm".to_string(), rating: "Good".to_string(),
                int_ext: "EXT".to_string(), day: 2, duration_sec: 4.5,
                cam_file: "C0004.MP4".to_string(), audio_file: "".to_string(),
                setup_id: Some(2), tags: "Clean take".to_string(), note: "".to_string(),
                created_at: "2026-01-01 10:00:00".to_string(),
            }],
            setups: vec![Setup { id: 2, scene_id: 5, name: "Wide".to_string(), take_count: 1 }],
            photos: vec![PhotoBackup {
                id: 3, scene_id: 5, setup_id: None, filename: "m.jpg".to_string(),
                caption: "Hat".to_string(), created_at: "2026-01-01 10:01:00".to_string(),
                full_bytes: vec![0, 1, 2, 250, 255, 13, 37],
                thumb_bytes: vec![9, 8, 7],
            }],
            trash_key: None,
        }
    }

    #[test]
    fn trash_round_trip_preserves_everything() {
        let dir = temp_trash("roundtrip");
        let item = UndoItem::Scene(sample_scene_bundle());
        let key = trash_save(&dir, &item).expect("save");
        let loaded = trash_load(&dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, key);
        assert_eq!(loaded[0].1, item);
        // Photo bytes survive as exact bytes (base64, not lossy).
        match &loaded[0].1 {
            UndoItem::Scene(b) => assert_eq!(b.photos[0].full_bytes, vec![0, 1, 2, 250, 255, 13, 37]),
            _ => panic!("wrong kind"),
        }
        trash_remove(&dir, &key);
        assert!(trash_load(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn trash_prune_keeps_newest_10() {
        let dir = temp_trash("prune");
        for _ in 0..12 {
            trash_save(&dir, &UndoItem::Scene(sample_scene_bundle()));
        }
        assert_eq!(trash_load(&dir).len(), 10);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn trash_skips_corrupt_files() {
        let dir = temp_trash("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("zzz-scene-1.json"), b"{oops").unwrap();
        trash_save(&dir, &UndoItem::Scene(sample_scene_bundle()));
        // "zzz…" sorts after real keys, corrupt entry skipped, good one loads.
        let loaded = trash_load(&dir);
        assert_eq!(loaded.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
