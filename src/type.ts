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

export interface GetLogsV2Query {
    from: number;
    to: number;
    query?: string;
    topic?: string;
    line?: number;
    offset?: number;
    reverse?: boolean;
    powerSql?: boolean;
    session?: string;
    forward?: boolean;
    highlight?: boolean;
    isAccurate?: boolean;
}

export interface CreateMaterializedView {
    name: string;
    logstore: string;
    originalSql: string;
    aggIntervalMins: number;
    startTime: number;
    ttl: number;
}

export interface ListMaterializedViewsQuery {
    offset?: number;
    size?: number;
    externalStoreName?: string;
}

export interface GetMaterializedViewResponse {
    name: string;
    logstore: string;
    originalSql: string;
    aggIntervalMins: number;
    startTime: number;
    ttl: number;
    enabled: boolean;
}

export interface ListMaterializedViewsResponse {
    total: number;
    count: number;
    materializedViews: string[];
}

export type GetLogsResponse<T extends Record<string, any> = Record<string, any>> = Array<{
    __topic__: string;
    __source__: string;
    __time__: string;
    __time_ns_part__: string;
} & T>;

export interface GetLogsV2Meta {
    progress: "Complete" | "Incomplete";
    count: number;
    hasSQL: boolean;
    aggQuery?: string;
    whereQuery?: string;
    processedRows?: number;
    elapsedMillisecond?: number;
    cpuSec?: number;
    cpuCores?: number;
    keys?: string[];
    terms?: Array<Record<string, string | number>>;
    limited?: number;
    mode?: number;
    phraseQueryInfo?: {
        scanAll: boolean;
        beginOffset: number;
        endOffset: number;
        endTime: number;
    };
    scanBytes?: number;
    highlights?: Array<Array<{
        Key: string;
        Value: string;
    }>>;
    processedBytes?: number;
    isAccurate?: boolean;
    columnTypes?: string[];
    telementryType?: string;
}

export interface GetLogsV2Response<T extends Record<string, any> = Record<string, any>> {
    meta: GetLogsV2Meta;
    data: Array<{
        __topic__: string;
        __source__: string;
        __time__: string;
        __time_ns_part__: string;
    } & T>;
}

export interface AliCloudSLSLogOption {
    accessKeyID: string;
    accessKeySecret: string;
    endpoint: string;
    globalSafeKyOptions?: SafeKyOptions;
}

export interface RequestConfig {
    endpoint: string;
    accessKeyID: string;
    accessKeySecret: string;
    stsToken?: string;
    globalSafeKyOptions?: SafeKyOptions;
}
