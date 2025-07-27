class Settings {
  redisUrl: string = process.env.REDIS_URL || "redis://localhost:6379/0";
  ppDefault: string = process.env.PAYMENT_PROCESSOR_URL_DEFAULT || "";
  ppFallback: string = process.env.PAYMENT_PROCESSOR_URL_FALLBACK || "";
  healthCacheTtl: number = 5;
}

let settings: Settings | null = null;

export function getSettings(): Settings {
  if (!settings) {
    settings = new Settings();
  }
  return settings;
}
