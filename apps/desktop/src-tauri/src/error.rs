use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
    pub recoverable: bool,
    pub user_action: Option<&'static str>,
}

impl AppError {
    pub fn io(error: std::io::Error) -> Self {
        Self {
            code: "FILE_IO_ERROR",
            message: error.to_string(),
            recoverable: true,
            user_action: Some("请检查文件路径和访问权限后重试"),
        }
    }
}
