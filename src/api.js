// Slate Log — every Tauri backend call lives here, one named function each.
// app.js must never call invoke() directly: this module is the single seam,
// so tests can stub the transport and the wrapper list doubles as the
// frontend/backend contract (see src/tests/api.test.js).

const invoke = async (cmd, args = {}) => {
  if (globalThis.__TAURI__?.core?.invoke) return globalThis.__TAURI__.core.invoke(cmd, args);
  throw new Error("no-tauri");
};

// ---------- projects ----------
export const listProjects = () => invoke("list_projects");
export const createProject = (project) => invoke("create_project", { project });
export const updateProject = (id, project) => invoke("update_project", { id, project });
export const deleteProject = (id) => invoke("delete_project", { id });
export const duplicateProject = (id) => invoke("duplicate_project", { id });
export const setProjectDay = (id, day) => invoke("set_project_day", { id, day });

// ---------- scenes ----------
export const listScenes = (projectId) => invoke("list_scenes", { projectId });
export const createScene = (projectId, scene) => invoke("create_scene", { projectId, scene });
export const updateScene = (id, scene) => invoke("update_scene", { id, scene });
export const deleteScene = (id) => invoke("delete_scene", { id });
export const setAllSceneCameras = (projectId, camera) =>
  invoke("set_all_scene_cameras", { projectId, camera });

// ---------- setups ----------
export const listSetups = (sceneId) => invoke("list_setups", { sceneId });
export const createSetup = (sceneId, name) => invoke("create_setup", { sceneId, name });
export const deleteSetup = (id) => invoke("delete_setup", { id });

// ---------- takes ----------
export const listTakes = (sceneId) => invoke("list_takes", { sceneId });
export const listProjectTakes = (projectId) => invoke("list_project_takes", { projectId });
export const nextTake = (sceneId) => invoke("next_take", { sceneId });
export const logTake = (take) => invoke("log_take", { take });
export const updateTake = (id, take) => invoke("update_take", { id, take });
export const deleteTake = (takeId) => invoke("delete_take", { takeId });
export const getStats = (projectId) => invoke("get_stats", { projectId });

// ---------- photos / posters ----------
export const listPhotos = (sceneId) => invoke("list_photos", { sceneId });
export const addPhoto = (sceneId, setupId) => invoke("add_photo", { sceneId, setupId });
export const photoData = (id, thumb) => invoke("photo_data", { id, thumb });
export const updatePhotoCaption = (id, caption) => invoke("update_photo_caption", { id, caption });
export const deletePhoto = (id) => invoke("delete_photo", { id });
export const photoCounts = (projectId) => invoke("photo_counts", { projectId });
export const pickStagePoster = () => invoke("pick_stage_poster");
export const stagedPosterData = (key) => invoke("staged_poster_data", { key });
export const projectPosterData = (projectId) => invoke("project_poster_data", { projectId });
export const removeProjectPoster = (projectId) => invoke("remove_project_poster", { projectId });

// ---------- import / export ----------
export const importScenesCsv = (projectId) => invoke("import_scenes_csv", { projectId });
export const importScreenplayPdf = () => invoke("import_screenplay_pdf");
export const parseScreenplayText = (text) => invoke("parse_screenplay_text", { text });
export const importParsedScenes = (projectId, scenes) =>
  invoke("import_parsed_scenes", { projectId, scenes });
export const exportExcel = (projectId, includeGood, includeDays) =>
  invoke("export_excel", { projectId, includeGood, includeDays });
export const exportPdf = (projectId, day) => invoke("export_pdf", { projectId, day });
export const exportEdl = (projectId) => invoke("export_edl", { projectId });

// ---------- set mode (phone link) ----------
export const setStart = (sceneId, port) => invoke("set_start", { sceneId, port });
export const setStop = () => invoke("set_stop");
export const setServerScene = (sceneId) => invoke("set_scene", { sceneId });
export const setInfo = () => invoke("set_info");
export const setQr = () => invoke("set_qr");

// ---------- updates ----------
export const appVersion = () => invoke("app_version");
export const checkUpdate = () => invoke("check_update");
export const installUpdate = () => invoke("install_update");

// ---------- undo ----------
export const undoDelete = () => invoke("undo_delete");
