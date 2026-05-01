use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarPort(Mutex::new(None)))
        .manage(SidecarChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_sidecar_port])
        .setup(|app| {
            let handle = app.handle().clone();

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
                eprintln!("[tauri] No bundled or virtualenv runtime found - falling back to `uv`");
            }

            let sidecar_cmd = if let Some(py) = bundled {
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
            };

            let (mut rx, child) = sidecar_cmd.spawn().expect("Failed to spawn Python sidecar");

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
