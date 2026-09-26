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
    pub camera_a: String,
    pub camera_b: String,
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
    pub camera_a: String,
    pub camera_b: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub cam_file: String,
    pub audio_file: String,
    pub setup_id: Option<i64>,
    pub setup_name: String,
    pub tags: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setup {
    pub id: i64,
    pub scene_id: i64,
    pub name: String,
    pub take_count: i64,
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
    // One "14" per project. May fail on DBs that already contain duplicates
    // from the unconstrained era — the app-level checks below still guard
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
        "SELECT p.id, p.film_name, p.director, p.camera_op, p.location, p.unit, p.shoot_day, p.total_days, p.camera_a, p.camera_b,
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
            camera_a: r.get(8)?,
            camera_b: r.get(9)?,
            scene_count: r.get(10)?,
            take_count: r.get(11)?,
            good_count: r.get(12)?,
        })
    })?;
    rows.collect()
}

pub fn insert_project(app: &AppHandle, p: NewProject) -> rusqlite::Result<Project> {
    let conn = connect(app)?;
    conn.execute(
        "INSERT INTO projects (film_name, director, camera_op, location, unit, shoot_day, total_days, camera_a, camera_b) VALUES (?,?,?,?,?,?,?,?,?)",
        params![p.film_name, p.director, p.camera_op, p.location, p.unit, p.shoot_day, p.total_days, p.camera_a, p.camera_b],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Project { id, film_name: p.film_name, director: p.director, camera_op: p.camera_op, location: p.location, unit: p.unit, shoot_day: p.shoot_day, total_days: p.total_days, camera_a: p.camera_a, camera_b: p.camera_b, scene_count: 0, take_count: 0, good_count: 0 })
}

pub fn update_project(app: &AppHandle, id: i64, p: NewProject) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    conn.execute(
        "UPDATE projects SET film_name=?1, director=?2, camera_op=?3, location=?4, unit=?5, shoot_day=?6, total_days=?7, camera_a=?8, camera_b=?9 WHERE id=?10",
        params![p.film_name, p.director, p.camera_op, p.location, p.unit, p.shoot_day, p.total_days, p.camera_a, p.camera_b, id],
    )?;
    Ok(())
}

pub fn remove_project(app: &AppHandle, id: i64) -> rusqlite::Result<()> {
    let conn = connect(app)?;
    conn.execute("DELETE FROM takes WHERE scene_id IN (SELECT id FROM scenes WHERE project_id=?1)", params![id])?;
    conn.execute("DELETE FROM setups WHERE scene_id IN (SELECT id FROM scenes WHERE project_id=?1)", params![id])?;
    conn.execute("DELETE FROM scenes WHERE project_id=?1", params![id])?;
    conn.execute("DELETE FROM projects WHERE id=?1", params![id])?;
    Ok(())
}

pub fn duplicate_project(app: &AppHandle, id: i64) -> rusqlite::Result<Project> {
    let conn = connect(app)?;
    let src: NewProject = conn.query_row(
        "SELECT film_name, director, camera_op, location, unit, shoot_day, total_days, camera_a, camera_b FROM projects WHERE id=?1",
        params![id],
        |r| {
            Ok(NewProject {
                film_name: r.get(0)?, director: r.get(1)?, camera_op: r.get(2)?,
                location: r.get(3)?, unit: r.get(4)?, shoot_day: r.get(5)?,
                total_days: r.get(6)?, camera_a: r.get(7)?, camera_b: r.get(8)?,
            })
        },
    )?;
    let name = format!("Copy of {}", src.film_name);
    conn.execute(
        "INSERT INTO projects (film_name, director, camera_op, location, unit, shoot_day, total_days, camera_a, camera_b) VALUES (?,?,?,?,?,?,?,?,?)",
        params![name, src.director, src.camera_op, src.location, src.unit, src.shoot_day, src.total_days, src.camera_a, src.camera_b],
    )?;
    let new_pid = conn.last_insert_rowid();
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
            "SELECT take_no, tc_in, cam, lens, rating, int_ext, day, cam_file, audio_file, setup_id, tags, note, created_at FROM takes WHERE scene_id=?1",
        )?;
        let old_takes: Vec<(i64, String, String, String, String, String, i64, String, String, Option<i64>, String, String, String)> = tstmt
            .query_map(params![old_sid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(tstmt);
        for (take_no, tc_in, cam, lens, rating, int_ext, tday, cam_file, audio_file, setup_id, tags, note, created_at) in old_takes {
            let new_setup = setup_id.and_then(|s| setup_map.get(&s).copied());
            conn.execute(
                "INSERT INTO takes (scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, cam_file, audio_file, setup_id, tags, note, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                params![new_sid, take_no, tc_in, cam, lens, rating, int_ext, tday, cam_file, audio_file, new_setup, tags, note, created_at],
            )?;
        }
    }
    Ok(Project {
        id: new_pid, film_name: name, director: src.director, camera_op: src.camera_op,
        location: src.location, unit: src.unit, shoot_day: src.shoot_day, total_days: src.total_days,
        camera_a: src.camera_a, camera_b: src.camera_b, scene_count: 0, take_count: 0, good_count: 0,
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
    let conn = connect(app)?;
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
    conn.execute("DELETE FROM setups WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- Takes ----------

pub fn fetch_takes(app: &AppHandle, scene_id: i64) -> rusqlite::Result<Vec<Take>> {
    let conn = connect(app)?;
    // connect() always runs the int_ext/day migrations first, so the column exists.
    let mut stmt = conn.prepare(
        "SELECT id, scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, cam_file, audio_file, setup_id, tags, note, created_at FROM takes WHERE scene_id=?1 ORDER BY take_no",
    )?;
    let rows = stmt.query_map(params![scene_id], |r| {
        Ok(Take {
            id: r.get(0)?, scene_id: r.get(1)?, take_no: r.get(2)?, tc_in: r.get(3)?,
            cam: r.get(4)?, lens: r.get(5)?, rating: r.get(6)?, int_ext: r.get(7)?,
            day: r.get(8).unwrap_or(1), cam_file: r.get(9).unwrap_or_default(), audio_file: r.get(10).unwrap_or_default(),
            setup_id: r.get(11).unwrap_or(None),
            tags: r.get(12)?, note: r.get(13)?, created_at: r.get(14)?,
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
        "INSERT INTO takes (scene_id, take_no, tc_in, cam, lens, rating, int_ext, day, cam_file, audio_file, setup_id, tags, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![t.scene_id, no, t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.cam_file, t.audio_file, t.setup_id, t.tags, t.note],
    )?;
    let id = conn.last_insert_rowid();
    let created: String = conn.query_row("SELECT created_at FROM takes WHERE id=?1", params![id], |r| r.get(0))?;
    Ok(Take { id, scene_id: t.scene_id, take_no: no, tc_in: t.tc_in, cam: t.cam, lens: t.lens, rating: t.rating, int_ext: t.int_ext, day: t.day, cam_file: t.cam_file, audio_file: t.audio_file, setup_id: t.setup_id, tags: t.tags, note: t.note, created_at: created })
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
        "UPDATE takes SET tc_in=?1, cam=?2, lens=?3, rating=?4, int_ext=?5, day=?6, cam_file=?7, audio_file=?8, setup_id=?9, tags=?10, note=?11 WHERE id=?12",
        params![t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.cam_file, t.audio_file, t.setup_id, t.tags, t.note, id],
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
        "SELECT t.id, t.scene_id, s.number, s.title, t.take_no, t.tc_in, t.cam, t.lens, t.rating, t.int_ext, t.day, t.cam_file, t.audio_file, t.setup_id, su.name, t.tags, t.note, t.created_at
         FROM takes t JOIN scenes s ON s.id = t.scene_id LEFT JOIN setups su ON su.id = t.setup_id
         WHERE s.project_id = ?1
         ORDER BY CAST(s.number AS INTEGER), s.number, t.take_no",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(TakeWithScene {
            id: r.get(0)?, scene_id: r.get(1)?, scene_number: r.get(2)?, scene_title: r.get(3)?,
            take_no: r.get(4)?, tc_in: r.get(5)?, cam: r.get(6)?, lens: r.get(7)?,
            rating: r.get(8)?, int_ext: r.get(9)?, day: r.get(10)?, cam_file: r.get(11)?, audio_file: r.get(12)?,
            setup_id: r.get(13).unwrap_or(None), setup_name: r.get(14).unwrap_or_default(),
            tags: r.get(15)?, note: r.get(16)?,
            created_at: r.get(17)?,
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
