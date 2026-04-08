export interface AIPluginSettings {
    apiKey: string;
    baseUrl: string;
    model: string;
    availableModels: string[];
    fontSize: number;
    loggingEnabled: boolean;
    logsRetentionDays: number;
    sessionsRetentionDays: number;
}

export const DEFAULT_SETTINGS: AIPluginSettings = {
    apiKey: '',
    baseUrl: 'https://routerai.ru/api/v1',
    model: '',
    availableModels: [],
    fontSize: 13,
    loggingEnabled: false,
    logsRetentionDays: 30,
    sessionsRetentionDays: 100,
};

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}
