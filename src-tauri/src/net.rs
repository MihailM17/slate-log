//! Set mode: a tiny LAN-only server so phones on set WiFi can push
//! continuity stills + quick takes straight into the live database.
//! No internet, no accounts. Token-gated; runs only while the user keeps it on.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{DefaultBodyLimit, Multipart, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use tauri::AppHandle;

#[derive(Clone)]
pub struct SetMode {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    running: bool,
    port: u16,
    token: String,
    scene_id: Option<i64>,
    handle: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl SetMode {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                running: false,
                port: 0,
                token: String::new(),
                scene_id: None,
                handle: None,
            })),
        }
    }

    fn authed(&self, q: &HashMap<String, String>) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.running && q.get("token").map(|t| t == &inner.token).unwrap_or(false)
    }

    pub async fn start(&self, app: &AppHandle, scene_id: Option<i64>) -> Result<(String, String, u16), String> {
        // Restart fresh each session so the token never outlives the modal.
        self.stop();
        let token = new_token();
        let ip = local_ip_address::local_ip().map_err(|e| e.to_string())?;
        // Bind inside the async runtime (Axum/Tokio sockets panic on the
        // main thread — a sync command here crashed the app).
        let mut port = 0u16;
        let mut listener = None;
        for p in 17831..=17845 {
            if let Ok(l) = tokio::net::TcpListener::bind(format!("0.0.0.0:{p}")).await {
                port = p;
                listener = Some(l);
                break;
            }
        }
        let listener = listener.ok_or("no free port for set mode (17831-17845)")?;
        {
            let mut inner = self.inner.lock().unwrap();
            inner.running = true;
            inner.port = port;
            inner.token = token.clone();
            inner.scene_id = scene_id;
        }
        let ctx = Ctx { app: app.clone(), set: self.clone() };
        let router = Router::new()
            .route("/", get(snap_page))
            .route("/api/context", get(api_context))
            .route("/api/scene", post(api_scene))
            .route("/api/take", post(api_take))
            .route("/api/photo", post(api_photo))
            .layer(DefaultBodyLimit::disable())
            .with_state(ctx);
        let handle = tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router.into_make_service()).await;
        });
        {
            let mut inner = self.inner.lock().unwrap();
            inner.handle = Some(handle);
        }
        let url = format!("http://{ip}:{port}/?token={token}");
        Ok((url, token, port))
    }

    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(h) = inner.handle.take() {
            h.abort();
        }
        inner.running = false;
    }

    pub fn set_scene(&self, scene_id: Option<i64>) {
        let mut inner = self.inner.lock().unwrap();
        if inner.running {
            inner.scene_id = scene_id;
        }
    }

    pub fn info(&self, app: &AppHandle) -> serde_json::Value {
        let inner = self.inner.lock().unwrap();
        let (number, title) = inner
            .scene_id
            .and_then(|id| {
                crate::db::fetch_scenes_for(app, id)
            })
            .map(|s| (s.number, s.title))
            .unwrap_or_default();
        serde_json::json!({
            "running": inner.running,
            "port": inner.port,
            "scene_number": number,
            "scene_title": title,
        })
    }

    pub fn qr(&self, app: &AppHandle) -> Result<String, String> {
        let (url, token, port) = {
            let inner = self.inner.lock().unwrap();
            if !inner.running {
                return Err("set mode is not running".into());
            }
            let ip = local_ip_address::local_ip().map_err(|e| e.to_string())?;
            (format!("http://{ip}:{}?token={}", inner.port, inner.token), inner.token.clone(), inner.port)
        };
        let _ = (app, token, port);
        qrcode::QrCode::new(url.as_bytes())
            .map_err(|e| e.to_string())
            .map(|c| {
                c.render::<qrcode::render::svg::Color>()
                    .min_dimensions(220, 220)
                    .build()
            })
    }
}

fn new_token() -> String {
    const A: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut s = String::with_capacity(8);
    for _ in 0..8 {
        s.push(A[rand::random::<u64>() as usize % A.len()] as char);
    }
    s
}

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    set: SetMode,
}

fn now_tc() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

// Phone screens show these raw — strip the rusqlite prefix.
fn user_err(e: rusqlite::Error) -> String {
    match e {
        rusqlite::Error::InvalidParameterName(s) => s,
        other => other.to_string(),
    }
}

async fn snap_page(State(ctx): State<Ctx>, Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
    if !ctx.set.authed(&q) {
        return (StatusCode::FORBIDDEN, Html("<h1>Wrong or missing token — rescan the code in Slate Log.</h1>".to_string()));
    }
    let token = q.get("token").cloned().unwrap_or_default();
    (StatusCode::OK, Html(SNAP_HTML.replace("__TOKEN__", &token)))
}

async fn api_context(State(ctx): State<Ctx>, Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
    if !ctx.set.authed(&q) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "bad token" })));
    }
    let projects = match crate::db::fetch_projects(&ctx.app) {
        Ok(p) => p,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    };
    let scene_id = ctx.set.inner.lock().unwrap().scene_id;
    // Scene list comes from the scene's own project (or the first project).
    let scene = scene_id.and_then(|id| crate::db::fetch_scenes_for(&ctx.app, id));
    let project_id = scene.as_ref().map(|s| s.project_id).or_else(|| projects.first().map(|p| p.id));
    let (scenes, setups) = match project_id {
        Some(pid) => {
            let scenes = crate::db::fetch_scenes(&ctx.app, pid).unwrap_or_default();
            let setups = scene
                .as_ref()
                .map(|s| crate::db::fetch_setups(&ctx.app, s.id).unwrap_or_default())
                .unwrap_or_default();
            (scenes, setups)
        }
        None => (vec![], vec![]),
    };
    let film = projects.first().map(|p| p.film_name.clone()).unwrap_or_default();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "film": film,
            "scene": scene,
            "scenes": scenes.iter().map(|s| serde_json::json!({ "id": s.id, "number": s.number, "title": s.title })).collect::<Vec<_>>(),
            "setups": setups.iter().map(|u| serde_json::json!({ "id": u.id, "name": u.name })).collect::<Vec<_>>(),
        })),
    )
}

async fn api_scene(State(ctx): State<Ctx>, Query(q): Query<HashMap<String, String>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    if !ctx.set.authed(&q) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "bad token" })));
    }
    let id = body.get("scene_id").and_then(|v| v.as_i64());
    match id {
        Some(sid) if crate::db::fetch_scenes_for(&ctx.app, sid).is_some() => {
            ctx.set.set_scene(Some(sid));
            (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
        }
        _ => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "unknown scene" }))),
    }
}

async fn api_take(State(ctx): State<Ctx>, Query(q): Query<HashMap<String, String>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    if !ctx.set.authed(&q) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "bad token" })));
    }
    let scene_id = match ctx.set.inner.lock().unwrap().scene_id {
        Some(id) => id,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "no scene selected" }))),
    };
    let scene = match crate::db::fetch_scenes_for(&ctx.app, scene_id) {
        Some(s) => s,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "unknown scene" }))),
    };
    let rating = body.get("rating").and_then(|v| v.as_str()).unwrap_or("Good").to_string();
    if !["Bad", "Maybe", "Good"].contains(&rating.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "bad rating" })));
    }
    let setup_id = body.get("setup_id").and_then(|v| v.as_i64());
    let take = crate::db::NewTake {
        scene_id,
        tc_in: now_tc(),
        cam: body.get("cam").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        lens: body.get("lens").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        rating,
        int_ext: scene.int_ext.clone(),
        day: scene.day,
        duration_sec: 0.0,
        cam_file: String::new(),
        audio_file: String::new(),
        setup_id,
        tags: String::new(),
        note: body.get("note").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    };
    let take = crate::db::NewTake {
        cam: if take.cam.is_empty() { scene.camera_default.clone() } else { take.cam },
        lens: if take.lens.is_empty() { "35mm".to_string() } else { take.lens },
        ..take
    };
    match crate::db::insert_take(&ctx.app, take) {
        Ok(t) => (StatusCode::OK, Json(serde_json::json!({ "ok": true, "take_no": t.take_no }))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": user_err(e) }))),
    }
}

async fn api_photo(State(ctx): State<Ctx>, Query(q): Query<HashMap<String, String>>, mut mp: Multipart) -> impl IntoResponse {
    if !ctx.set.authed(&q) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "bad token" })));
    }
    let scene_id = match ctx.set.inner.lock().unwrap().scene_id {
        Some(id) => id,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "no scene selected" }))),
    };
    let mut bytes: Option<Vec<u8>> = None;
    let mut filename = String::from("snap.jpg");
    let mut caption = String::new();
    let mut setup_id: Option<i64> = None;
    while let Ok(Some(field)) = mp.next_field().await {
        match field.name().unwrap_or("").to_string().as_str() {
            "image" => {
                if let Some(n) = field.file_name().map(|s| s.to_string()) {
                    filename = n;
                }
                match field.bytes().await {
                    Ok(b) => bytes = Some(b.to_vec()),
                    Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))),
                }
            }
            "caption" => {
                caption = field.text().await.unwrap_or_default();
            }
            "setup_id" => {
                let v = field.text().await.unwrap_or_default();
                setup_id = v.parse::<i64>().ok();
            }
            _ => {}
        }
    }
    let bytes = match bytes {
        Some(b) if !b.is_empty() && b.len() < 25_000_000 => b,
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "no image received" }))),
    };
    let tmp = std::env::temp_dir().join(format!("slate-snap-{}.tmp", chrono::Local::now().format("%Y%m%d%H%M%S%f")));
    if std::fs::write(&tmp, &bytes).is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "could not stage upload" })));
    }
    let _ = filename;
    let res = crate::db::import_photo(&ctx.app, scene_id, setup_id, tmp.clone());
    let _ = std::fs::remove_file(&tmp);
    match res {
        Ok(p) => {
            if !caption.trim().is_empty() {
                let _ = crate::db::update_photo_caption(&ctx.app, p.id, caption.trim().to_string());
            }
            (StatusCode::OK, Json(serde_json::json!({ "ok": true, "id": p.id })))
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": user_err(e) }))),
    }
}

// ---------- Tauri commands ----------

#[tauri::command]
pub async fn set_start(app: AppHandle, set: tauri::State<'_, SetMode>, scene_id: Option<i64>) -> Result<serde_json::Value, String> {
    let (url, _token, port) = set.start(&app, scene_id).await?;
    Ok(serde_json::json!({ "url": url, "port": port }))
}

#[tauri::command]
pub fn set_stop(set: tauri::State<SetMode>) -> Result<(), String> {
    set.stop();
    Ok(())
}

#[tauri::command]
pub fn set_scene(set: tauri::State<SetMode>, scene_id: Option<i64>) -> Result<(), String> {
    set.set_scene(scene_id);
    Ok(())
}

#[tauri::command]
pub fn set_info(app: AppHandle, set: tauri::State<SetMode>) -> Result<serde_json::Value, String> {
    Ok(set.info(&app))
}

#[tauri::command]
pub fn set_qr(app: AppHandle, set: tauri::State<SetMode>) -> Result<String, String> {
    set.qr(&app)
}

// ---------- Phone page (single self-contained file, no external assets) ----------

const SNAP_HTML: &str = r###"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Slate Log — Set snap</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#121110;color:#ece7df;font:16px/1.5 -apple-system,system-ui,sans-serif;padding:16px;max-width:560px;margin:0 auto}
h1{font-size:22px;margin:4px 0}.sub{color:#a39c90;font-size:13px;margin-bottom:12px}
.card{background:#1b1a17;border:1px solid #2c2a26;border-radius:12px;padding:14px;margin-bottom:12px}
label{display:block;font-size:12px;color:#a39c90;margin:10px 0 4px}
select,input,textarea{width:100%;background:#141312;border:1px solid #2c2a26;color:#ece7df;border-radius:8px;padding:11px;font-size:16px}
.seg{display:flex}.seg button{flex:1;background:transparent;border:1px solid #2c2a26;color:#a39c90;padding:13px;font-size:15px;font-weight:600}
.seg button:first-child{border-radius:8px 0 0 8px}.seg button:last-child{border-radius:0 8px 8px 0}
.seg button.on{background:#b44332;border-color:#b44332;color:#fff}
#shutter{display:block;width:100%;padding:22px;font-size:22px;font-weight:800;color:#fff;background:#b44332;border:none;border-radius:14px;margin:6px 0}
#shutter svg{vertical-align:-5px;margin-right:10px}
#preview{width:100%;border-radius:10px;display:none;margin-top:8px}
.btn{display:block;width:100%;padding:14px;margin-top:10px;font-size:16px;font-weight:700;border-radius:10px;border:1px solid #2c2a26;background:#211f1c;color:#ece7df}
.btn.primary{background:#b44332;border-color:#b44332}
#msg{text-align:center;color:#7ba05b;min-height:22px;margin-top:8px;font-weight:600}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
</style>
</head>
<body>
<h1>Set snap</h1>
<div class="sub" id="film">connecting…</div>
<div class="card">
<label>Scene</label><select id="scene"></select>
<label>Setup</label><select id="setup"></select>
<button id="shutter"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>SNAP</button>
<input type="file" id="file" accept="image/*" capture="environment" style="display:none">
<img id="preview" alt="">
<label>Caption</label><input id="caption" placeholder="e.g. Hat on left chair" autocomplete="off">
<button class="btn primary" id="upload">Upload still</button>
</div>
<div class="card">
<label>Quick take — rating</label>
<div class="seg" id="rating"><button data-v="Bad">Bad</button><button data-v="Maybe">Maybe</button><button data-v="Good" class="on">Good</button></div>
<div class="row2"><div><label>Camera</label><input id="cam" placeholder="A"></div><div><label>Lens</label><input id="lens" placeholder="35mm"></div></div>
<label>Note</label><input id="note" placeholder="What happened…" autocomplete="off">
<button class="btn primary" id="logtake">Log take</button>
</div>
<div id="msg"></div>
<script>
const TOKEN="__TOKEN__";
let rating="Good", curScene=null;
const $=(id)=>document.getElementById(id);
const say=(m,ok)=>{const e=$("msg");e.textContent=m;e.style.color=ok===false?"#e0705c":"#7ba05b";setTimeout(()=>{if(e.textContent===m)e.textContent="";},3000);};
document.querySelectorAll("#rating button").forEach(b=>{b.onclick=()=>{document.querySelectorAll("#rating button").forEach(x=>x.classList.remove("on"));b.classList.add("on");rating=b.dataset.v;};});
async function ctx(){
  const r=await fetch("api/context?token="+encodeURIComponent(TOKEN));const j=await r.json();
  if(j.error){say(j.error,false);return;}
  $("film").textContent=(j.film||"Slate Log")+(j.scene?(" · Sc "+j.scene.number):"");
  const ss=$("scene");ss.innerHTML="";j.scenes.forEach(s=>{const o=document.createElement("option");o.value=s.id;o.textContent=s.number+" · "+(s.title||"");if(j.scene&&s.id===j.scene.id)o.selected=true;ss.appendChild(o);});
  curScene=j.scene?j.scene.id:(j.scenes[0]?j.scenes[0].id:null);
  const su=$("setup");su.innerHTML="";const n0=document.createElement("option");n0.value="";n0.textContent="— Whole scene —";su.appendChild(n0);
  (j.setups||[]).forEach(u=>{const o=document.createElement("option");o.value=u.id;o.textContent=u.name;su.appendChild(o);});
}
$("scene").onchange=async()=>{const id=parseInt($("scene").value);await fetch("api/scene?token="+encodeURIComponent(TOKEN),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scene_id:id})});ctx();};
$("shutter").onclick=()=>$("file").click();
$("file").onchange=()=>{const f=$("file").files[0];if(!f)return;const p=$("preview");p.src=URL.createObjectURL(f);p.style.display="block";};
$("upload").onclick=async()=>{
  const f=$("file").files[0];if(!f){say("Snap a photo first",false);return;}
  const fd=new FormData();fd.append("image",f,f.name||"snap.jpg");fd.append("caption",$("caption").value);
  const su=$("setup").value;if(su)fd.append("setup_id",su);
  say("Uploading…");
  try{const r=await fetch("api/photo?token="+encodeURIComponent(TOKEN),{method:"POST",body:fd});const j=await r.json();
  if(j.ok){say("Still uploaded ✓");$("file").value="";$("preview").style.display="none";$("caption").value="";}else say(j.error||"failed",false);}catch(e){say("network error",false);}
};
$("logtake").onclick=async()=>{
  const su=$("setup").value;
  try{const r=await fetch("api/take?token="+encodeURIComponent(TOKEN),{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({rating,note:$("note").value,cam:$("cam").value,lens:$("lens").value,setup_id:su===""?null:parseInt(su)})});
  const j=await r.json();if(j.ok){say("Take "+String(j.take_no).padStart(2,"0")+" logged ✓");$("note").value="";$("file").value="";$("preview").style.display="none";$("caption").value="";}else say(j.error||"failed",false);}catch(e){say("network error",false);}
};
ctx();
</script>
</body>
</html>"###;
