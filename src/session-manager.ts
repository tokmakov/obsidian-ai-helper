import { Vault } from 'obsidian';
import { ChatMessage } from './types';

export interface ChatSession {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessage[];
    lastSuggestions?: string[];
}

export class SessionManager {
    private vault: Vault;
    private sessionsDir: string;
    private readonly MAX_DAYS = 100;
    private readonly TITLE_MAX_LENGTH = 75;

    constructor(vault: Vault, pluginDir: string) {
        this.vault = vault;
        this.sessionsDir = `${pluginDir}/sessions`;
    }

    private async ensureSessionsDir(): Promise<void> {
        try {
            await this.vault.adapter.mkdir(this.sessionsDir);
        } catch {
            // Папка уже существует
        }
    }

    private makeTitle(messages: ChatMessage[]): string {
        const firstUser = messages.find(m => m.role === 'user');
        if (!firstUser) return 'Новый чат';

        const text = firstUser.content.trim();
        if (text.length <= this.TITLE_MAX_LENGTH) return text;

        // Обрезаем по последнему слову
        const truncated = text.slice(0, this.TITLE_MAX_LENGTH);
        const lastSpace = truncated.lastIndexOf(' ');
        return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '...';
    }

    private makeId(): string {
        return new Date().toISOString().replace(/[:.]/g, '-');
    }

    private getFilePath(id: string): string {
        return `${this.sessionsDir}/${id}.json`;
    }

    async save(session: ChatSession): Promise<void> {
        await this.ensureSessionsDir();

        session.title = this.makeTitle(session.messages);
        session.updatedAt = new Date().toISOString();

        const filePath = this.getFilePath(session.id);
        await this.vault.adapter.write(filePath, JSON.stringify(session, null, 2));
    }

    async createNew(): Promise<ChatSession> {
        return {
            id: this.makeId(),
            title: 'Новый чат',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: []
        };
    }

    async loadAll(): Promise<ChatSession[]> {
        await this.ensureSessionsDir();

        try {
            const listing = await this.vault.adapter.list(this.sessionsDir);
            const sessions: ChatSession[] = [];

            for (const filePath of listing.files) {
                if (!filePath.endsWith('.json')) continue;
                try {
                    const raw = await this.vault.adapter.read(filePath);
                    const session = JSON.parse(raw) as ChatSession;
                    sessions.push(session);
                } catch {
                    console.error(`[AI Helper] Не удалось прочитать сессию: ${filePath}`);
                }
            }

            // Сортируем от новых к старым
            sessions.sort((a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );

            return sessions;
        } catch {
            return [];
        }
    }

    async delete(id: string): Promise<void> {
        const filePath = this.getFilePath(id);
        try {
            await this.vault.adapter.remove(filePath);
        } catch {
            console.error(`[AI Helper] Не удалось удалить сессию: ${id}`);
        }
    }

    async cleanOldSessions(retentionDays: number): Promise<void> {
        try {
            const listing = await this.vault.adapter.list(this.sessionsDir);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - retentionDays);

            for (const filePath of listing.files) {
                if (!filePath.endsWith('.json')) continue;
                try {
                    const raw = await this.vault.adapter.read(filePath);
                    const session = JSON.parse(raw) as ChatSession;
                    if (new Date(session.updatedAt) < cutoff) {
                        await this.vault.adapter.remove(filePath);
                        console.log(`[AI Helper] Удалена старая сессия: ${session.title}`);
                    }
                } catch {
                    await this.vault.adapter.remove(filePath);
                }
            }
        } catch {
            // Папки ещё нет — всё хорошо
        }
    }
}
