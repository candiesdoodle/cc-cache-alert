export interface AppConfig {
  telegram: {
    botToken: string;
    chatId: string;
    enabled: boolean;
  };
  cache: {
    ttlSeconds: number; // default 3600 (1 hour)
    alertThresholdPercent: number; // default 20 (alerts when <= 20% remains, i.e. 12 mins)
  };
  notifications: {
    sound: boolean;
    includeProjectName: boolean;
    includeSessionName: boolean; // sends session name (from /rename or slug)
    includeSessionId?: boolean; // legacy backward-compatibility alias
  };
}

export interface TranscriptEntry {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  customTitle?: string;
  slug?: string;
  message?: {
    content?: unknown;
    usage?: {
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export interface ActiveCacheState {
  isWorking: boolean;
  lastAssistantTime: Date | null;
  remainingSeconds: number;
  remainingPercent: number;
  isExpiringSoon: boolean; // true if remaining <= threshold
  isExpired: boolean;
}

export interface TimerMetadata {
  sessionId: string;
  sessionName?: string;
  transcriptPath: string;
  projectName: string;
  scheduledAt: number; // unix ms
  fireAt: number; // unix ms
  pid: number;
  ttlSeconds: number;
}
