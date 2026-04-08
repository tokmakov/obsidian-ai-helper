import { Notice } from 'obsidian';
import { AIPluginSettings, ChatMessage } from './types';
import { Logger } from './logger';

export type AIResult =
    | { success: true; content: string; suggestions: string[] }
    | { success: false };

export class AIClient {
    private settings: AIPluginSettings;
    private logger: Logger;

    constructor(settings: AIPluginSettings, logger: Logger) {
        this.settings = settings;
        this.logger = logger;
    }

    updateSettings(settings: AIPluginSettings): void {
        this.settings = settings;
    }

    private parseSuggestions(raw: string): { content: string; suggestions: string[] } {
        // Ищем блок из трех подсказок в самом конце ответа, они
        // должны идти подряд, разделённые только переносами строк
        const blockPattern = /(\{[^}]+\}\s*\n\s*){2}\{[^}]+\}\s*$/;

        const blockMatch = raw.match(blockPattern);

        if (!blockMatch) {
            return { content: raw.trim(), suggestions: [] };
        }

        // Извлекаем отдельные вопросы из найденного блока
        const block = blockMatch[0];
        const suggestions: string[] = [];
        const pattern = /\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(block)) !== null) {
            suggestions.push(match[1].trim());
        }

        // Убираем блок подсказок из контента
        const content = raw.slice(0, raw.length - block.length).trim();

        return { content, suggestions };
    }

    async sendMessage(messages: ChatMessage[]): Promise<AIResult> {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const result = await this.trySendMessage(messages);

            if (result.success) return result;

            // Повторяем только при сетевых ошибках
            if (result.retryable && attempt < MAX_RETRIES) {
                new Notice(`⏳ Соединение прервано, повтор...`);
                await this.logger.info(`Попытка ${attempt} не удалась, повторяем через ${RETRY_DELAY_MS} мс...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue;
            }

            return result;
        }

        return { success: false };
    }


    async trySendMessage(messages: ChatMessage): Promise<AIResult> {
        const { apiKey, baseUrl, model } = this.settings;

        if (!apiKey) {
            new Notice('⚠️ API Key не указан — зайди в настройки плагина');
            return { success: false };
        }
        if (!model) {
            new Notice('⚠️ Модель не выбрана — зайди в настройки плагина');
            return { success: false };
        }
        if (!baseUrl) {
            new Notice('⚠️ Base URL не указан — зайди в настройки плагина');
            return { success: false };
        }

        const cleanMessages = messages.map(m => ({
            role: m.role,
            content: String(m.content).trim()
        }));

        const payload = {
            model,
            messages: [
                {
                    role: 'system',
                    content: [
                        'Ты полезный AI-ассистент, встроенный в Obsidian — это база знаний для хранения заметок.',
                        'После основного ответа предложи три варианта следующего вопроса от лица пользователя.',
                        'Вопросы должны быть сформулированы от первого лица, как будто их задаёт пользователь.',
                        'Формат строго следующий (включая фигурные скобки, без дополнительных пояснений):',
                        '{Вопрос 1}',
                        '{Вопрос 2}',
                        '{Вопрос 3}'
                    ].join('\n')
                },
                ...cleanMessages
            ]
        };

        await this.logger.request(payload);

        let response: Response;
        try {
            const bodyStr = JSON.stringify(payload);
            console.log('Размер payload (байт):', bodyStr.length);
            response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Connection': 'close'
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            await this.logger.error('Сетевая ошибка', error);
            new Notice('❌ Не удалось подключиться к серверу — подробности в логах');
            return { success: false, retryable: true };
        }

        if (!response.ok) {
            let details = '';
            try {
                const body = await response.json();
                details = body?.error?.message ?? JSON.stringify(body);
            } catch {
                details = await response.text();
            }

            await this.logger.error('Ошибка HTTP', { status: response.status, details });
            new Notice(`❌ Ошибка сервера ${response.status} — подробности в логах`);
            return { success: false };
        }

        try {
            const data = await response.json();
            await this.logger.response(data);

            const raw = data?.choices?.[0]?.message?.content;
            if (!raw) {
                await this.logger.error('Пустой ответ от сервера', data);
                new Notice('⚠️ Сервер вернул пустой ответ — попробуй другую модель');
                return { success: false };
            }

            const { content, suggestions } = this.parseSuggestions(raw);
            return { success: true, content, suggestions };

        } catch (error) {
            await this.logger.error('Ошибка парсинга ответа', error);
            new Notice('❌ Не удалось разобрать ответ сервера — подробности в логах');
            return { success: false };
        }
    }
}
