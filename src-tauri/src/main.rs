// Prevents an extra console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{NewWindowResponse, PermissionKind, PermissionResponse, WebviewWindowBuilder},
    Manager, Url, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::WindowExt as WindowStateExt;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRUSTED_HOST: &str = "snout.cloud";

/// Override the default URL with the SNOUT_URL environment variable so
/// self-hosted deployments just work without a custom build.
fn startup_url() -> Url {
    std::env::var("SNOUT_URL")
        .ok()
        .and_then(|s| Url::parse(&s).ok())
        .filter(is_trusted_destination)
        .unwrap_or_else(|| Url::parse("https://snout.cloud").expect("hardcoded URL is valid"))
}

// ---------------------------------------------------------------------------
// URL guards
// ---------------------------------------------------------------------------

/// Resolve the single trusted host from an optional override string.
///
/// If the override is a valid HTTPS URL with no credentials its host is used,
/// replacing `TRUSTED_HOST`. An invalid or insecure override is silently
/// ignored and the production default is used instead.
fn trusted_host_from(override_url: Option<&str>) -> String {
    override_url
        .and_then(|s| Url::parse(s).ok())
        .filter(|u| {
            u.scheme() == "https"
                && u.host_str().is_some()
                && u.port_or_known_default() == Some(443)
                && u.username().is_empty()
                && u.password().is_none()
        })
        .and_then(|u| u.host_str().map(|h| h.to_owned()))
        .unwrap_or_else(|| TRUSTED_HOST.to_owned())
}

/// Resolve the trusted host, reading the SNOUT_URL env var at call time.
fn trusted_host() -> String {
    trusted_host_from(std::env::var("SNOUT_URL").ok().as_deref())
}

/// Core predicate: is `url` the trusted origin identified by `host`?
fn is_trusted_with_host(url: &Url, host: &str) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(host)
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

/// Accept only the resolved trusted origin.
pub fn is_trusted_destination(url: &Url) -> bool {
    is_trusted_with_host(url, &trusted_host())
}

/// Any plain HTTPS link without embedded credentials — safe to open in the
/// system browser.
pub fn is_safe_external_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

// ---------------------------------------------------------------------------
// Permission policy
// ---------------------------------------------------------------------------

pub fn permission_response(url: Option<Url>, kind: PermissionKind) -> PermissionResponse {
    // Camera/mic/screen are only granted when the page is on the trusted origin.
    // Tauri exposes the top-level webview URL here, which may differ from the
    // frame's own origin when the server sets restrictive Permission-Policy
    // headers, so we check conservatively.
    let trusted = url.as_ref().map(is_trusted_destination).unwrap_or(false);
    if !trusted {
        return PermissionResponse::Deny;
    }
    match kind {
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::DisplayCapture => {
            PermissionResponse::Allow
        }
        _ => PermissionResponse::Deny,
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    // Block navigation to anything that isn't the trusted origin.
    let navigation_guard = tauri::plugin::Builder::<tauri::Wry>::new("snout-trusted-origin")
        .on_navigation(|webview, url| {
            if is_trusted_destination(url) {
                return true;
            }
            // Open safe external links in the system browser instead of
            // allowing them to navigate the app window.
            if is_safe_external_https(url) {
                let _ = webview
                    .app_handle()
                    .opener()
                    .open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build();

    tauri::Builder::default()
        // Persist window position/size across restarts.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Bring existing instance to the front instead of opening a second one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(navigation_guard)
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ----------------------------------------------------------------
            // System-tray icon with a minimal context menu
            // ----------------------------------------------------------------
            let show_item = MenuItem::with_id(app, "show", "Show Snout", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::with_id("snout-tray")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        // This path is unreachable in a correctly configured build
                        // because tauri.conf.json always supplies at least one icon.
                        // If it somehow fires it means the bundle is broken, so
                        // panicking early is correct behaviour.
                        .expect("icon must be configured in tauri.conf.json"),
                )
                .tooltip("Snout")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on the tray icon toggles the window.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                                // On macOS, hide from the Dock too so the app
                                // lives only in the menu bar when minimised.
                                #[cfg(target_os = "macos")]
                                let _ = app.set_activation_policy(
                                    tauri::ActivationPolicy::Accessory,
                                );
                            } else {
                                // Restore Dock presence before showing.
                                #[cfg(target_os = "macos")]
                                let _ = app.set_activation_policy(
                                    tauri::ActivationPolicy::Regular,
                                );
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // ----------------------------------------------------------------
            // Main window
            // ----------------------------------------------------------------
            let start_url = startup_url();
            let app_handle = app.handle().clone();

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start_url))
                .title("Snout")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 620.0)
                .center()
                .on_navigation(is_trusted_destination)
                .on_new_window(move |url, _features| {
                    if is_safe_external_https(&url) {
                        let _ = app_handle
                            .opener()
                            .open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .on_permission_request(|webview, kind| {
                    permission_response(webview.url().ok(), kind)
                })
                .build()?;

            // Restore previously saved window position/size (window-state plugin).
            let _ = window.restore_state(tauri_plugin_window_state::StateFlags::all());

            // Per-OS appearance tweaks.
            #[cfg(target_os = "windows")]
            {
                use tauri::Theme;
                let _ = window.set_theme(Some(Theme::Dark));
            }
            #[cfg(target_os = "macos")]
            {
                use tauri::Theme;
                // Dark title bar to match Snout's dark UI.
                let _ = window.set_theme(Some(Theme::Dark));
            }

            // Suppress the unused variable warning on platforms that don't
            // enter either cfg block above.
            let _ = &window;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Snout desktop client failed to start");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{is_safe_external_https, is_trusted_destination, permission_response};
    use tauri::{
        webview::{PermissionKind, PermissionResponse},
        Url,
    };

    // --- is_trusted_destination ---

    #[test]
    fn allows_only_the_snout_https_origin() {
        assert!(is_trusted_destination(
            &Url::parse("https://snout.cloud/").unwrap()
        ));
        assert!(is_trusted_destination(
            &Url::parse("https://snout.cloud/some/deep/path?q=1").unwrap()
        ));
    }

    #[test]
    fn rejects_http_scheme() {
        assert!(!is_trusted_destination(
            &Url::parse("http://snout.cloud/").unwrap()
        ));
    }

    #[test]
    fn rejects_different_host() {
        assert!(!is_trusted_destination(
            &Url::parse("https://example.com/").unwrap()
        ));
    }

    #[test]
    fn rejects_subdomain_confusion() {
        assert!(!is_trusted_destination(
            &Url::parse("https://snout.cloud.attacker.test/").unwrap()
        ));
        assert!(!is_trusted_destination(
            &Url::parse("https://evil.snout.cloud/").unwrap()
        ));
    }

    #[test]
    fn rejects_embedded_credentials() {
        assert!(!is_trusted_destination(
            &Url::parse("https://user:pw@snout.cloud/").unwrap()
        ));
    }

    #[test]
    fn rejects_non_standard_port() {
        assert!(!is_trusted_destination(
            &Url::parse("https://snout.cloud:8443/").unwrap()
        ));
    }

    // --- is_safe_external_https ---

    #[test]
    fn external_links_require_clean_https() {
        assert!(is_safe_external_https(
            &Url::parse("https://pay.platega.io/checkout").unwrap()
        ));
        assert!(!is_safe_external_https(
            &Url::parse("http://example.com/").unwrap()
        ));
        assert!(!is_safe_external_https(
            &Url::parse("https://user:pass@example.com/").unwrap()
        ));
        assert!(!is_safe_external_https(
            &Url::parse("https://example.com:8443/").unwrap()
        ));
    }

    // --- permission_response ---

    #[test]
    fn allows_media_only_for_trusted_origin() {
        let snout = Some(Url::parse("https://snout.cloud/").unwrap());
        let other = Some(Url::parse("https://example.com/").unwrap());

        assert_eq!(
            permission_response(snout.clone(), PermissionKind::Microphone),
            PermissionResponse::Allow
        );
        assert_eq!(
            permission_response(snout.clone(), PermissionKind::Camera),
            PermissionResponse::Allow
        );
        assert_eq!(
            permission_response(snout.clone(), PermissionKind::DisplayCapture),
            PermissionResponse::Allow
        );
        assert_eq!(
            permission_response(snout.clone(), PermissionKind::Geolocation),
            PermissionResponse::Deny
        );
        assert_eq!(
            permission_response(other, PermissionKind::Microphone),
            PermissionResponse::Deny
        );
        assert_eq!(
            permission_response(None, PermissionKind::Camera),
            PermissionResponse::Deny
        );
    }

    #[test]
    fn denies_all_permissions_for_unknown_origin() {
        let unknown = Some(Url::parse("https://evil.snout.cloud/").unwrap());
        assert_eq!(
            permission_response(unknown.clone(), PermissionKind::Camera),
            PermissionResponse::Deny
        );
        assert_eq!(
            permission_response(unknown, PermissionKind::Microphone),
            PermissionResponse::Deny
        );
    }

    // --- SNOUT_URL self-hosted override ---
    //
    // We test `trusted_host_from` directly with explicit inputs rather than
    // mutating the process-wide env var, which would race against other
    // parallel test threads.

    #[test]
    fn self_hosted_override_accepts_its_own_origin() {
        use super::{is_safe_external_https, is_trusted_with_host, trusted_host_from};
        let host = trusted_host_from(Some("https://chat.example.com"));
        let url = Url::parse("https://chat.example.com/").unwrap();
        assert_eq!(url.host_str(), Some(host.as_str()));
        assert!(
            is_trusted_with_host(&url, &host),
            "own self-hosted origin must be trusted"
        );
        assert!(is_safe_external_https(&url));
    }

    #[test]
    fn self_hosted_override_rejects_default_origin() {
        use super::trusted_host_from;
        let host = trusted_host_from(Some("https://chat.example.com"));
        // snout.cloud is not the resolved host when an override is active.
        assert_ne!(
            host, "snout.cloud",
            "default host must not be trusted when SNOUT_URL overrides it"
        );
        let snout_url = Url::parse("https://snout.cloud/").unwrap();
        assert!(
            snout_url.host_str() != Some(&host),
            "snout.cloud must not match the self-hosted override host"
        );
    }

    #[test]
    fn invalid_snout_url_env_falls_back_to_production() {
        use super::trusted_host_from;
        assert_eq!(
            trusted_host_from(Some("not-a-url")),
            "snout.cloud",
            "malformed override must fall back to snout.cloud"
        );
        assert_eq!(
            trusted_host_from(Some("http://chat.example.com")),
            "snout.cloud",
            "http override must be rejected and fall back to snout.cloud"
        );
        assert_eq!(
            trusted_host_from(Some("https://user:pw@chat.example.com")),
            "snout.cloud",
            "override with credentials must be rejected"
        );
        assert_eq!(
            trusted_host_from(None),
            "snout.cloud",
            "no override must use snout.cloud"
        );
    }
}
