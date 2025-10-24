import type { Options as KyOptions } from "ky";

export type SafeKyOptions = Omit<KyOptions, "method" | "body" | "headers">;

export interface LogEntity {
    content: Record<string, any>;
    timestamp?: number;
    timestampNsPart?: number;
}

export interface LogData {
    logs: LogEntity[];
    tags?: Array<Record<string, string>>;
    topic?: string;
    source?: string;
}

export interface GetLogsQuery {
    from: number;
    to: number;
    query?: string;
    topic?: string;
    line?: number;
    offset?: number;
    reverse?: boolean;
    powerSql?: boolean;
}

export type GetLogsResponse<T extends Record<string, any> = Record<string, any>> = Array<{
    __topic__: string;
    __source__: string;
    __time__: string;
    __time_ns_part__: string;
} & T>;

export interface AliCloudSLSLogOption {
    accessKeyID: string;
    accessKeySecret: string;
    endpoint: string;
    globalSafeKyOptions?: SafeKyOptions;
}
