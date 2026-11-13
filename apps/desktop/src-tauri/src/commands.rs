use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::error::AppError;
use wait_timeout::ChildExt;

const WORD_TO_PDF_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open($env:QINGXIAN_SOURCE, $false, $true)
    if ($document.Fields.Count -gt 0) { $document.Fields.Update() | Out-Null }
    $document.ExportAsFixedFormat($env:QINGXIAN_TARGET, 17, $false, 0, 0, 1, 9999999, 0, $true, $true, 1, $true, $true, $false)
    Write-Output 'Microsoft Word'
} finally {
    if ($null -ne $document) { $document.Close($false) }
    if ($null -ne $word) { $word.Quit() }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
"#;

const PDF_TO_WORD_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$word = $null
$document = $null
$optionsPath = 'HKCU:\SOFTWARE\Microsoft\Office\16.0\Word\Options'
$warningName = 'DisableConvertPdfWarning'
$hadWarningValue = $false
$previousWarningValue = $null
try {
    if (-not (Test-Path $optionsPath)) { New-Item -Path $optionsPath -Force | Out-Null }
    $existing = Get-ItemProperty -Path $optionsPath -Name $warningName -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        $hadWarningValue = $true
        $previousWarningValue = $existing.$warningName
    }
    New-ItemProperty -Path $optionsPath -Name $warningName -PropertyType DWord -Value 1 -Force | Out-Null
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.Options.ConfirmConversions = $false
    $document = $word.Documents.Open($env:QINGXIAN_SOURCE, $false, $false, $false, '', '', $false, '', '', 0, 65001, $false, $false, 0, $true)
    $document.SaveAs2($env:QINGXIAN_TARGET, 16)
    Write-Output 'Microsoft Word PDF Reflow'
} finally {
    if ($null -ne $document) { $document.Close($false) }
    if ($null -ne $word) { $word.Quit() }
    if ($hadWarningValue) {
        New-ItemProperty -Path $optionsPath -Name $warningName -PropertyType DWord -Value $previousWarningValue -Force | Out-Null
    } else {
        Remove-ItemProperty -Path $optionsPath -Name $warningName -ErrorAction SilentlyContinue
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
"#;

fn normalized_markdown_path(path: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if !matches!(extension.as_str(), "md" | "markdown") {
        return Err(AppError {
            code: "UNSUPPORTED_FILE_TYPE",
            message: "仅支持 .md 和 .markdown 文件".into(),
            recoverable: true,
            user_action: Some("请选择 Markdown 文件"),
        });
    }

    Ok(path.to_path_buf())
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError {
        code: "INVALID_FILE_PATH",
        message: "目标文件缺少父目录".into(),
        recoverable: true,
        user_action: Some("请选择有效的保存位置"),
    })?;
    fs::create_dir_all(parent).map_err(AppError::io)?;

    let temporary = path.with_extension("qingxian.tmp");
    fs::write(&temporary, content).map_err(AppError::io)?;
    if path.exists() {
        fs::remove_file(path).map_err(AppError::io)?;
    }
    fs::rename(temporary, path).map_err(AppError::io)
}

fn validate_source_path(path: &str, extensions: &[&str]) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(AppError {
            code: "CONVERSION_SOURCE_NOT_FOUND",
            message: "待转换文件不存在或无法访问".into(),
            recoverable: true,
            user_action: Some("请重新选择有效文件"),
        });
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !extensions.contains(&extension.as_str()) {
        return Err(AppError {
            code: "UNSUPPORTED_CONVERSION_SOURCE",
            message: format!("不支持转换 .{extension} 文件"),
            recoverable: true,
            user_action: Some("请选择支持的 Word 或 PDF 文件"),
        });
    }
    if path.is_absolute() {
        Ok(path)
    } else {
        path.canonicalize().map_err(AppError::io)
    }
}

fn validate_target_path(path: &str, extension: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path);
    let actual_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if actual_extension != extension {
        return Err(AppError {
            code: "UNSUPPORTED_CONVERSION_TARGET",
            message: format!("目标文件必须使用 .{extension} 扩展名"),
            recoverable: true,
            user_action: Some("请选择正确的导出格式"),
        });
    }
    let parent = path.parent().ok_or_else(|| AppError {
        code: "INVALID_FILE_PATH",
        message: "目标文件缺少父目录".into(),
        recoverable: true,
        user_action: Some("请选择有效的保存位置"),
    })?;
    fs::create_dir_all(parent).map_err(AppError::io)?;
    Ok(path)
}

fn conversion_temp_path(target: &Path, extension: &str) -> Result<PathBuf, AppError> {
    let parent = target.parent().ok_or_else(|| AppError {
        code: "INVALID_FILE_PATH",
        message: "目标文件缺少父目录".into(),
        recoverable: true,
        user_action: Some("请选择有效的保存位置"),
    })?;
    let name = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    Ok(parent.join(format!(".{name}.qingxian-converting.{extension}")))
}

fn run_office_conversion(
    script: &str,
    source: &Path,
    temporary_target: &Path,
) -> Result<String, AppError> {
    if temporary_target.exists() {
        fs::remove_file(temporary_target).map_err(AppError::io)?;
    }
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("QINGXIAN_SOURCE", source)
        .env("QINGXIAN_TARGET", temporary_target)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError {
            code: "OFFICE_ENGINE_UNAVAILABLE",
            message: format!("无法启动 Microsoft Word 转换引擎：{error}"),
            recoverable: true,
            user_action: Some("请确认已安装桌面版 Microsoft Word"),
        })?;

    let status = child
        .wait_timeout(Duration::from_secs(180))
        .map_err(AppError::io)?;
    if status.is_none() {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(temporary_target);
        return Err(AppError {
            code: "OFFICE_CONVERSION_TIMEOUT",
            message: "文档转换超过 3 分钟，任务已终止".into(),
            recoverable: true,
            user_action: Some("请检查源文件是否损坏、加密或包含未关闭的提示框"),
        });
    }

    let output = child.wait_with_output().map_err(AppError::io)?;
    if !output.status.success() {
        let _ = fs::remove_file(temporary_target);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError {
            code: "OFFICE_CONVERSION_FAILED",
            message: if detail.is_empty() {
                "Microsoft Word 无法转换该文件，文件可能已损坏、加密或受保护".into()
            } else {
                format!("Microsoft Word 转换失败：{detail}")
            },
            recoverable: true,
            user_action: Some("请确认文件可在 Microsoft Word 中正常打开"),
        });
    }

    let metadata = fs::metadata(temporary_target).map_err(|_| AppError {
        code: "OFFICE_CONVERSION_EMPTY",
        message: "转换引擎未生成目标文件".into(),
        recoverable: true,
        user_action: Some("请确认源文件可在 Microsoft Word 中正常打开"),
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(temporary_target);
        return Err(AppError {
            code: "OFFICE_CONVERSION_EMPTY",
            message: "转换生成的文件为空".into(),
            recoverable: true,
            user_action: Some("请重新转换或检查源文件"),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn finish_conversion(temporary: &Path, target: &Path) -> Result<(), AppError> {
    if target.exists() {
        fs::remove_file(target).map_err(AppError::io)?;
    }
    fs::rename(temporary, target).map_err(AppError::io)
}

fn safe_export_file_name(file_name: &str) -> Result<&str, AppError> {
    if file_name.is_empty()
        || file_name.contains(['/', '\\'])
        || file_name == "."
        || file_name == ".."
        || !file_name.to_ascii_lowercase().ends_with(".png")
    {
        return Err(AppError {
            code: "INVALID_IMAGE_FILE_NAME",
            message: "分页图片文件名无效".into(),
            recoverable: true,
            user_action: Some("请重新导出分页图片"),
        });
    }
    Ok(file_name)
}

#[tauri::command]
pub fn document_open(path: String) -> Result<String, AppError> {
    let path = normalized_markdown_path(&path)?;
    fs::read_to_string(path).map_err(AppError::io)
}

#[tauri::command]
pub fn document_save(path: String, content: String) -> Result<(), AppError> {
    let path = normalized_markdown_path(&path)?;
    atomic_write(&path, content.as_bytes())
}

#[tauri::command]
pub fn export_html(path: String, html: String) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|value| value.to_str()) != Some("html") {
        return Err(AppError {
            code: "UNSUPPORTED_EXPORT_TYPE",
            message: "HTML 导出路径必须使用 .html 扩展名".into(),
            recoverable: true,
            user_action: Some("请选择 .html 文件"),
        });
    }
    atomic_write(&path, html.as_bytes())
}

#[tauri::command]
pub fn export_pdf(path: String, data: Vec<u8>) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "pdf" {
        return Err(AppError {
            code: "UNSUPPORTED_EXPORT_TYPE",
            message: "PDF 导出路径必须使用 .pdf 扩展名".into(),
            recoverable: true,
            user_action: Some("请选择 .pdf 文件"),
        });
    }
    if data.is_empty() {
        return Err(AppError {
            code: "EMPTY_PDF_DATA",
            message: "PDF 数据为空".into(),
            recoverable: true,
            user_action: Some("请重新导出 PDF"),
        });
    }
    atomic_write(&path, &data)
}

#[tauri::command]
pub fn export_docx(path: String, data: Vec<u8>) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "docx" {
        return Err(AppError {
            code: "UNSUPPORTED_EXPORT_TYPE",
            message: "Word 导出路径必须使用 .docx 扩展名".into(),
            recoverable: true,
            user_action: Some("请选择 .docx 文件"),
        });
    }
    if data.is_empty() {
        return Err(AppError {
            code: "EMPTY_DOCX_DATA",
            message: "Word 数据为空".into(),
            recoverable: true,
            user_action: Some("请重新导出 Word"),
        });
    }
    atomic_write(&path, &data)
}

fn convert_word_to_pdf_blocking(source_path: String, target_path: String) -> Result<String, AppError> {
    let source = validate_source_path(&source_path, &["doc", "docx", "docm", "rtf", "odt"])?;
    let target = validate_target_path(&target_path, "pdf")?;
    let temporary = conversion_temp_path(&target, "pdf")?;
    let engine = run_office_conversion(WORD_TO_PDF_SCRIPT, &source, &temporary)?;
    finish_conversion(&temporary, &target)?;
    Ok(if engine.is_empty() {
        "Word 已高保真转换为 PDF".into()
    } else {
        format!("Word 已通过 {engine} 高保真转换为 PDF")
    })
}

fn convert_pdf_to_word_blocking(source_path: String, target_path: String) -> Result<String, AppError> {
    let source = validate_source_path(&source_path, &["pdf"])?;
    let target = validate_target_path(&target_path, "docx")?;
    let temporary = conversion_temp_path(&target, "docx")?;
    let engine = run_office_conversion(PDF_TO_WORD_SCRIPT, &source, &temporary)?;
    finish_conversion(&temporary, &target)?;
    Ok(if engine.is_empty() {
        "PDF 已重排转换为可编辑 Word".into()
    } else {
        format!("PDF 已通过 {engine} 重排转换为可编辑 Word")
    })
}

fn conversion_task_error() -> AppError {
    AppError {
        code: "OFFICE_CONVERSION_TASK_FAILED",
        message: "后台文档转换任务异常终止".into(),
        recoverable: true,
        user_action: Some("请关闭可能残留的 Word 提示框后重试"),
    }
}

#[tauri::command]
pub async fn convert_word_to_pdf(
    source_path: String,
    target_path: String,
) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_word_to_pdf_blocking(source_path, target_path)
    })
    .await
    .map_err(|_| conversion_task_error())?
}

#[tauri::command]
pub async fn convert_pdf_to_word(
    source_path: String,
    target_path: String,
) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_pdf_to_word_blocking(source_path, target_path)
    })
    .await
    .map_err(|_| conversion_task_error())?
}

#[tauri::command]
pub async fn read_pdf_for_page_export(source_path: String) -> Result<Vec<u8>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = validate_source_path(&source_path, &["pdf"])?;
        fs::read(source).map_err(AppError::io)
    })
    .await
    .map_err(|_| conversion_task_error())?
}

#[tauri::command]
pub async fn convert_word_to_pdf_data(source_path: String) -> Result<Vec<u8>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = validate_source_path(&source_path, &["doc", "docx", "docm", "rtf", "odt"])?;
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = std::env::temp_dir().join(format!("qingxian-page-export-{unique}.pdf"));
        run_office_conversion(WORD_TO_PDF_SCRIPT, &source, &temporary)?;
        let result = fs::read(&temporary).map_err(AppError::io);
        let _ = fs::remove_file(&temporary);
        result
    })
    .await
    .map_err(|_| conversion_task_error())?
}

#[tauri::command]
pub async fn save_page_image(
    directory: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = PathBuf::from(directory);
        if !directory.is_dir() {
            return Err(AppError {
                code: "INVALID_IMAGE_EXPORT_DIRECTORY",
                message: "分页图片输出目录不存在".into(),
                recoverable: true,
                user_action: Some("请重新选择输出目录"),
            });
        }
        let file_name = safe_export_file_name(&file_name)?;
        if data.is_empty() {
            return Err(AppError {
                code: "EMPTY_PAGE_IMAGE",
                message: "页面图片数据为空".into(),
                recoverable: true,
                user_action: Some("请重新导出分页图片"),
            });
        }
        let target = directory.join(file_name);
        atomic_write(&target, &data)
    })
    .await
    .map_err(|_| conversion_task_error())?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    #[ignore = "requires desktop Microsoft Word"]
    fn office_round_trip_preserves_complex_document() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        let directory = std::env::temp_dir().join(format!("qingxian-office-test-{unique}"));
        fs::create_dir_all(&directory).expect("create temp directory");
        let source = directory.join("complex-source.docx");
        let pdf = directory.join("complex-output.pdf");
        let restored = directory.join("complex-restored.docx");
        let image = directory.join("scan-like-page.png");
        let create_script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 1000, 600
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Microsoft YaHei', 32)
$graphics.DrawString('扫描件图片测试：表格、公式与中文内容', $font, [System.Drawing.Brushes]::Black, 45, 240)
$bitmap.Save($env:QINGXIAN_IMAGE, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Add()
    $selection = $word.Selection
    $selection.Style = -63
    $selection.TypeText('青弦复杂文档转换测试')
    $selection.TypeParagraph()
    $selection.Style = -2
    $selection.TypeText('一、复杂排版与表格')
    $selection.TypeParagraph()
    $selection.Style = -1
    $selection.TypeText('这是一段用于验证粗体、分页、中文和原生 Word 排版的正文。')
    $selection.TypeParagraph()
    $table = $document.Tables.Add($selection.Range, 4, 3)
    $table.Cell(1,1).Range.Text = '项目'
    $table.Cell(1,2).Range.Text = '公式'
    $table.Cell(1,3).Range.Text = '结果'
    $table.Cell(2,1).Range.Text = '质能方程'
    $table.Cell(2,2).Range.Text = 'E = mc²'
    $table.Cell(2,3).Range.Text = '通过'
    $table.Cell(3,1).Range.Text = '积分'
    $table.Cell(3,2).Range.Text = '∫e⁻ˣ²dx'
    $table.Cell(3,3).Range.Text = '通过'
    $table.Cell(4,1).Range.Text = '长文本'
    $table.Cell(4,2).Range.Text = '表格单元格内容自动换行并保持边框和对齐。'
    $table.Cell(4,3).Range.Text = '通过'
    $selection.SetRange($document.Content.End - 1, $document.Content.End - 1)
    $selection.TypeParagraph()
    $selection.Style = -2
    $selection.TypeText('二、公式对象')
    $selection.TypeParagraph()
    $formulaRange = $document.Range($document.Content.End - 1, $document.Content.End - 1)
    $formulaRange.Text = 'x^2+y^2=z^2'
    $document.OMaths.Add($formulaRange) | Out-Null
    $document.OMaths.BuildUp()
    $selection.SetRange($document.Content.End - 1, $document.Content.End - 1)
    $selection.InsertBreak(7)
    $selection.Style = -2
    $selection.TypeText('三、扫描页视觉保留')
    $selection.TypeParagraph()
    $selection.InlineShapes.AddPicture($env:QINGXIAN_IMAGE) | Out-Null
    $selection.SetRange($document.Content.End - 1, $document.Content.End - 1)
    $selection.TypeParagraph()
    1..20 | ForEach-Object {
        $selection.TypeText("分页内容 $_：用于验证多页文档转换和复杂元素还原。")
        $selection.TypeParagraph()
    }
    $document.SaveAs2($env:QINGXIAN_SOURCE, 16)
} finally {
    if ($null -ne $document) { $document.Close($false) }
    if ($null -ne $word) { $word.Quit() }
}
"#;
        let status = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                create_script,
            ])
            .env("QINGXIAN_SOURCE", &source)
            .env("QINGXIAN_IMAGE", &image)
            .status()
            .expect("start Microsoft Word fixture generator");
        assert!(status.success(), "fixture generation failed");

        convert_word_to_pdf_blocking(
            source.to_string_lossy().into_owned(),
            pdf.to_string_lossy().into_owned(),
        )
        .expect("Word to PDF conversion");
        convert_pdf_to_word_blocking(
            pdf.to_string_lossy().into_owned(),
            restored.to_string_lossy().into_owned(),
        )
        .expect("PDF to Word conversion");

        assert!(fs::metadata(&pdf).expect("PDF metadata").len() > 10_000);
        assert!(fs::metadata(&restored).expect("DOCX metadata").len() > 10_000);
        let _ = fs::remove_dir_all(directory);
    }
}
