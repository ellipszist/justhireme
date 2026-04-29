use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

struct SidecarPort(Mutex<Option<u16>>);
struct SidecarChild(Mutex<Option<CommandChild>>);

#[tauri::command]
fn get_sidecar_port(state: State<SidecarPort>) -> Result<u16, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Sidecar port not yet discovered".into())
}

fn bundled_python_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarPort(Mutex::new(None)))
        .manage(SidecarChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_sidecar_port])
        .setup(|app| {
            let handle = app.handle().clone();

            let backend_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.join("backend"))
                .unwrap_or_else(|| {
                    std::env::current_dir().unwrap_or_default().join("backend")
                });

            let bundled = bundled_python_path(&handle);
            if let Some(ref py) = bundled {
                eprintln!("[tauri] Using bundled runtime: {}", py.display());
            } else {
                eprintln!("[tauri] No bundled runtime found — falling back to `uv`");
            }

            let sidecar_cmd = if let Some(py) = bundled {
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
            };

            let (mut rx, child) = sidecar_cmd
                .spawn()
                .expect("Failed to spawn Python sidecar");

            // Store child handle so it persists for app lifetime and is killed on drop
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
                            }
                        }
                        CommandEvent::Stderr(b) => {
                            let line = String::from_utf8_lossy(&b).trim().to_string();
                            if !line.is_empty() {
                                eprintln!("[sidecar] {line}");
                            }
                        }
                        CommandEvent::Terminated(s) => {
                            eprintln!("[tauri] Sidecar terminated: {:?}", s.code);
                            let _ = app_handle.emit("sidecar-terminated", ());
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
