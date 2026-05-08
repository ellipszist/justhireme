#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarPort(Mutex<Option<u16>>);
struct ApiTokenState(Mutex<Option<String>>);
struct SidecarChild(Mutex<Option<CommandChild>>);
struct SidecarError(Mutex<Option<String>>);

#[tauri::command]
fn get_sidecar_port(state: State<SidecarPort>) -> Result<u16, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Sidecar port not yet discovered".into())
}

#[tauri::command]
fn get_api_token(state: State<ApiTokenState>) -> Result<String, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "API token not yet discovered".into())
}

#[tauri::command]
fn get_sidecar_error(state: State<SidecarError>) -> Result<String, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No sidecar error recorded".into())
}

#[tauri::command]
fn notify_high_score_lead(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;

    let _ = app
        .notification()
        .builder()
        .title(&title)
        .body(&body)
        .show();
}

#[cfg(debug_assertions)]
fn bundled_python_path(app: &AppHandle) -> Option<PathBuf> {
    let runtime_dir = app
        .path()
        .resource_dir()
        .ok()?
        .join("resources")
        .join("python-runtime");

    let candidates = if cfg!(windows) {
        vec!["python.exe", "python"]
    } else {
        vec!["bin/python3", "bin/python", "python"]
    };

    candidates
        .into_iter()
        .map(|candidate| runtime_dir.join(candidate))
        .find(|path| path.exists())
}

#[cfg(debug_assertions)]
fn local_venv_python_path(backend_dir: &Path) -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![".venv/Scripts/python.exe", ".venv/Scripts/python"]
    } else {
        vec![
            ".venv/bin/python3",
            ".venv/bin/python",
            ".venv/bin/python.exe",
        ]
    };

    candidates
        .into_iter()
        .map(|candidate| backend_dir.join(candidate))
        .find(|path| path.exists())
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }
}

fn shutdown_sidecar(app: &AppHandle) {
    let child = app
        .state::<SidecarChild>()
        .0
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());

    if let Some(child) = child {
        let pid = child.pid();
        eprintln!("[tauri] Stopping sidecar process tree: {pid}");
        kill_process_tree(pid);
        let _ = child.kill();
    }

    if let Ok(mut port) = app.state::<SidecarPort>().0.lock() {
        *port = None;
    }

    if let Ok(mut token) = app.state::<ApiTokenState>().0.lock() {
        *token = None;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarPort(Mutex::new(None)))
        .manage(ApiTokenState(Mutex::new(None)))
        .manage(SidecarChild(Mutex::new(None)))
        .manage(SidecarError(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_sidecar_port,
            get_api_token,
            get_sidecar_error,
            notify_high_score_lead
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(debug_assertions)]
            let sidecar_cmd = {
                let backend_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .map(|p| p.join("backend"))
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("backend"));

                let bundled = bundled_python_path(&handle);
                let local_venv = local_venv_python_path(&backend_dir);

                if let Some(ref py) = bundled {
                    eprintln!("[tauri] Using bundled runtime: {}", py.display());
                } else if let Some(ref py) = local_venv {
                    eprintln!("[tauri] Using backend virtualenv: {}", py.display());
                } else {
                    eprintln!(
                        "[tauri] No bundled or virtualenv runtime found - falling back to `uv`"
                    );
                }

                if let Some(py) = bundled {
                    handle
                        .shell()
                        .command(py.to_string_lossy().to_string())
                        .args(["main.py"])
                        .current_dir(&backend_dir)
                } else if let Some(py) = local_venv {
                    handle
                        .shell()
                        .command(py.to_string_lossy().to_string())
                        .args(["main.py"])
                        .current_dir(&backend_dir)
                } else {
                    handle
                        .shell()
                        .command("uv")
                        .args(["run", "python", "main.py"])
                        .current_dir(&backend_dir)
                }
            };

            #[cfg(not(debug_assertions))]
            let sidecar_cmd = {
                eprintln!("[tauri] Using bundled backend sidecar");
                // Tauri installs externalBin sidecars beside the app executable under
                // the binary basename, so this resolves to jhm-sidecar.exe on Windows.
                handle
                    .shell()
                    .sidecar("jhm-sidecar")
                    .expect("failed to create sidecar command")
            };

            let mut sidecar_cmd = sidecar_cmd;
            sidecar_cmd = sidecar_cmd.env("PYTHONUNBUFFERED", "1");
            if let Ok(app_data_dir) = handle.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&app_data_dir);
                let app_data = app_data_dir.to_string_lossy().to_string();
                sidecar_cmd = sidecar_cmd
                    .env("LOCALAPPDATA", app_data.clone())
                    .env("JHM_APP_DATA_DIR", app_data);
            }
            if let Ok(resource_dir) = handle.path().resource_dir() {
                let browsers_path = resource_dir
                    .join("resources")
                    .join("bin")
                    .join("ms-playwright");
                if browsers_path.exists() {
                    sidecar_cmd = sidecar_cmd.env(
                        "PLAYWRIGHT_BROWSERS_PATH",
                        browsers_path.to_string_lossy().to_string(),
                    );
                }
            }

            let (mut rx, child) = match sidecar_cmd.spawn() {
                Ok(result) => result,
                Err(err) => {
                    let msg = format!("Failed to spawn Python sidecar: {err}");
                    eprintln!("[tauri] {msg}");
                    if let Ok(mut guard) = handle.state::<SidecarError>().0.lock() {
                        *guard = Some(msg.clone());
                    }
                    let _ = handle.emit("sidecar-error", msg);
                    return Ok(());
                }
            };

            let sidecar_pid = child.pid();
            eprintln!("[tauri] Sidecar PID: {sidecar_pid}");

            if let Ok(mut guard) = handle.state::<SidecarChild>().0.lock() {
                *guard = Some(child);
            }

            let app_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(b) => {
                            let line = String::from_utf8_lossy(&b).trim().to_string();
                            if let Some(port_str) = line.strip_prefix("PORT:") {
                                if let Ok(port) = port_str.parse::<u16>() {
                                    if let Ok(mut g) = app_handle.state::<SidecarPort>().0.lock() {
                                        *g = Some(port);
                                    }
                                    let _ = app_handle.emit("sidecar-port", port);
                                    eprintln!("[tauri] Sidecar port: {port}");
                                }
                            } else if let Some(token) = line.strip_prefix("JHM_TOKEN=") {
                                if let Ok(mut g) = app_handle.state::<ApiTokenState>().0.lock() {
                                    *g = Some(token.to_string());
                                }
                                let _ = app_handle.emit("sidecar-token", token.to_string());
                            }
                        }
                        CommandEvent::Stderr(b) => {
                            let line = String::from_utf8_lossy(&b).trim().to_string();
                            if !line.is_empty() {
                                eprintln!("[sidecar] {line}");
                                if let Ok(mut guard) = app_handle.state::<SidecarError>().0.lock() {
                                    *guard = Some(line.clone());
                                }
                                let _ = app_handle.emit("sidecar-error", line);
                            }
                        }
                        CommandEvent::Terminated(s) => {
                            eprintln!("[tauri] Sidecar terminated: {:?}", s.code);
                            let msg = format!("Sidecar terminated before startup: {:?}", s.code);
                            if let Ok(mut guard) = app_handle.state::<SidecarError>().0.lock() {
                                *guard = Some(msg.clone());
                            }
                            let _ = app_handle.emit("sidecar-error", msg);
                            let _ = app_handle.emit("sidecar-terminated", ());
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent { label, event, .. } => {
            eprintln!("[tauri] Window event on {label}: {event:?}");
        }
        RunEvent::ExitRequested { code, .. } => {
            eprintln!("[tauri] Exit requested: {code:?}");
            shutdown_sidecar(app_handle);
        }
        RunEvent::Exit => {
            eprintln!("[tauri] App exit");
            shutdown_sidecar(app_handle);
        }
        _ => {}
    });
}
