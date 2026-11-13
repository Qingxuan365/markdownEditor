mod commands;
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::document_open,
            commands::document_save,
            commands::convert_word_to_pdf,
            commands::convert_pdf_to_word,
            commands::read_pdf_for_page_export,
            commands::convert_word_to_pdf_data,
            commands::save_page_image,
            commands::export_html,
            commands::export_docx,
            commands::export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Qingxian Editor");
}
