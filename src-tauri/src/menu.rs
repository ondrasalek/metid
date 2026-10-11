use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let builder = MenuItemBuilder::with_id(id, text);
    match accelerator {
        Some(a) => builder.accelerator(a).build(app),
        None => builder.build(app),
    }
}

/// Native menu bar. Command ids ("open", "save", …) are forwarded to the
/// frontend, which routes them to whichever view is active. The Edit menu must
/// keep the predefined items — they are what make ⌘C/⌘V/⌘Z work in inputs.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let open = item(app, "open", "Open…", Some("CmdOrCtrl+O"))?;
    let save = item(app, "save", "Save", Some("CmdOrCtrl+S"))?;
    let revert = item(app, "revert", "Revert to Saved", None)?;
    let add = item(app, "add", "Add Tag or Column…", Some("CmdOrCtrl+T"))?;
    let find = item(app, "find", "Find…", Some("CmdOrCtrl+F"))?;
    let single = item(app, "view-single", "Single File", Some("CmdOrCtrl+1"))?;
    let batch = item(app, "view-batch", "Batch Edit", Some("CmdOrCtrl+2"))?;

    let app_menu = SubmenuBuilder::new(app, "Metid")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&save)
        .item(&revert)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&add)
        .item(&find)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&single)
        .item(&batch)
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()
}
