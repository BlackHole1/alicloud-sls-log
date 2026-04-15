import type {
    AliCloudSLSLogOption,
    CreateMaterializedView,
    GetLogsQuery,
    GetLogsResponse,
    GetLogsV2Query,
    GetLogsV2Response,
    GetMaterializedViewResponse,
    ListMaterializedViewsQuery,
    ListMaterializedViewsResponse,
    LogData,
    SafeKyOptions,
} from "./type";
import proto from "protobufjs";
import { Request } from "./request";

const protoSrc = `
package sls;

message Log {
    required uint32 Time = 1;// UNIX Time Format
    message Content {
        required string Key = 1;
        required string Value = 2;
    }  
    repeated Content Contents = 2;
    optional fixed32 TimeNs = 4;
}

message LogTag {
    required string Key = 1;
    required string Value = 2;
}

message LogGroup {
    repeated Log Logs= 1;
    optional string Reserved = 2; // reserved fields
    optional string Topic = 3;
    optional string Source = 4;
    repeated LogTag LogTags = 6;
}

message LogGroupList {
    repeated LogGroup logGroupList = 1;
}
`.trim();

const builder = proto.parse(protoSrc).root;
const LogGroupProto = builder.lookupType("sls.LogGroup");
export class AliCloudSLSLog extends Request {
    public constructor(config: AliCloudSLSLogOption) {
        super(config);
    }

    public async putLogs(projectName: string, logstoreName: string, data: LogData, safeKyOptions?: SafeKyOptions): Promise<void> {
        const payload: Record<string, any> = {
            Logs: data.logs.map((log) => {
                const { seconds, nanoseconds } = splitTimestamp(log.timestamp);
                return {
                    Time: seconds,
                    TimeNs: log.timestampNsPart || nanoseconds,
                    Contents: Object.entries(log.content).map(([Key, Value]) => {
                        return { Key, Value };
                    }),
                };
            }),
        };

        if (data.tags?.length) {
            payload.LogTags = data.tags.flatMap(tag =>
                Object.entries(tag).map(([Key, Value]) => ({ Key, Value })),
            );
        }

        if (data.topic) {
            payload.Topic = data.topic;
        }

        if (data.source) {
            payload.Source = data.source;
        }

        const body = LogGroupProto.encode(LogGroupProto.create(payload)).finish();

        this.do({
            method: "POST",
            path: `/logstores/${logstoreName}/shards/lb`,
            headers: {
                "x-log-bodyrawsize": String(body.byteLength),
                "content-type": "application/x-protobuf",
            },
            projectName,
            body,
            safeKyOptions,
        });
    }

    public async getLogs<T extends Record<string, any> = Record<string, any>>(projectName: string, logstoreName: string, query: GetLogsQuery, safeKyOptions?: SafeKyOptions): Promise<GetLogsResponse<T>> {
        const fromSec = splitTimestamp(query.from).seconds;
        const toSec = splitTimestamp(query.to).seconds;

        return this.do({
            method: "GET",
            path: `/logstores/${logstoreName}`,
            queries: {
                type: "log",
                ...query,
                from: fromSec,
                to: toSec,
            },
            projectName,
            safeKyOptions,
        });
    }

    public async getLogsV2<T extends Record<string, any> = Record<string, any>>(projectName: string, logstoreName: string, query: GetLogsV2Query, safeKyOptions?: SafeKyOptions): Promise<GetLogsV2Response<T>> {
        const fromSec = splitTimestamp(query.from).seconds;
        const toSec = splitTimestamp(query.to).seconds;

        return this.do({
            method: "POST",
            path: `/logstores/${logstoreName}/logs`,
            headers: {
                "accept-encoding": "gzip",
            },
            projectName,
            body: JSON.stringify({
                ...query,
                from: fromSec,
                to: toSec,
            }),
            safeKyOptions,
        });
    }

    public async createMaterializedView(projectName: string, data: CreateMaterializedView, safeKyOptions?: SafeKyOptions): Promise<void> {
        await this.do({
            method: "POST",
            path: "/materializedviews",
            projectName,
            body: JSON.stringify(data),
            safeKyOptions,
        });
    }

    public async listMaterializedViews(projectName: string, query?: ListMaterializedViewsQuery, safeKyOptions?: SafeKyOptions): Promise<ListMaterializedViewsResponse> {
        return this.do({
            method: "GET",
            path: "/materializedviews",
            queries: query,
            projectName,
            safeKyOptions,
        });
    }

    public async getMaterializedView(projectName: string, materializedViewName: string, safeKyOptions?: SafeKyOptions): Promise<GetMaterializedViewResponse> {
        return this.do({
            method: "GET",
            path: `/materializedviews/${materializedViewName}`,
            projectName,
            safeKyOptions,
        });
    }

    public async deleteMaterializedView(projectName: string, materializedViewName: string, safeKyOptions?: SafeKyOptions): Promise<void> {
        await this.do({
            method: "DELETE",
            path: `/materializedviews/${materializedViewName}`,
            projectName,
            safeKyOptions,
        });
    }
}

function splitTimestamp(timestamp: number | undefined): { seconds: number; nanoseconds: number } {
    const time = timestamp || Date.now();

    if (time < 1000000000000) {
        return { seconds: time, nanoseconds: 0 };
    }

    return { seconds: Math.floor(time / 1000), nanoseconds: Math.floor(time * 1000 * 1000) % 1000000000 };
}
