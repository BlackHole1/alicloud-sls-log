import type { LogEntity } from "./type";

export function createLog(content: Record<string, any>, timestamp?: number, timestampNsPart?: number): LogEntity {
    return {
        content,
        timestamp,
        timestampNsPart,
    };
}
