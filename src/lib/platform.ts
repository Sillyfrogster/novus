const platform = import.meta.env.TAURI_ENV_PLATFORM?.toLowerCase();

export const isDesktop = platform !== "android" && platform !== "ios";
