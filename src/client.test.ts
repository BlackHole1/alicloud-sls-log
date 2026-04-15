import type {
    CreateMaterializedView,
    GetLogsV2Response,
    GetMaterializedViewResponse,
    ListMaterializedViewsQuery,
    ListMaterializedViewsResponse,
    SafeKyOptions,
} from "./type";
import { describe, expect, test } from "bun:test";
import { AliCloudSLSLog } from "./client";

interface CapturedRequest {
    method: "POST" | "GET" | "PUT" | "DELETE";
    path: string;
    projectName?: string;
    queries?: Record<string, any>;
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    safeKyOptions?: SafeKyOptions;
}

class TestClient extends AliCloudSLSLog {
    public request?: CapturedRequest;
    public response: unknown;

    public constructor(response: unknown = undefined) {
        super({
            accessKeyID: "test-ak",
            accessKeySecret: "test-sk",
            endpoint: "cn-hangzhou.log.aliyuncs.com",
        });
        this.response = response;
    }

    protected override async do(options: CapturedRequest): Promise<any> {
        this.request = options;
        return this.response;
    }
}

describe("AliCloudSLSLog materialized view", () => {
    test("createMaterializedView 会调用官方创建接口", async () => {
        const client = new TestClient();
        const input: CreateMaterializedView = {
            name: "daily_usage_mv",
            logstore: "execution_log",
            originalSql: "* | select user_id, count(*) as calls group by user_id",
            aggIntervalMins: 5,
            startTime: 1_712_678_400,
            ttl: 30,
        };

        await client.createMaterializedView("project-a", input, { timeout: 5000 });

        expect(client.request).toEqual({
            method: "POST",
            path: "/materializedviews",
            projectName: "project-a",
            queries: undefined,
            safeKyOptions: { timeout: 5000 },
            body: JSON.stringify(input),
        });
    });

    test("listMaterializedViews 会透传分页和模式过滤参数", async () => {
        const response: ListMaterializedViewsResponse = {
            count: 1,
            total: 10,
            materializedViews: ["daily_usage_mv"],
        };
        const client = new TestClient(response);
        const query: ListMaterializedViewsQuery = {
            offset: 20,
            size: 100,
            externalStoreName: "daily_",
        };

        const result = await client.listMaterializedViews("project-a", query, { timeout: 4000 });

        expect(result).toBe(response);
        expect(client.request).toEqual({
            method: "GET",
            path: "/materializedviews",
            projectName: "project-a",
            queries: query,
            safeKyOptions: { timeout: 4000 },
        });
    });

    test("getMaterializedView 会请求单个物化视图详情", async () => {
        const response: GetMaterializedViewResponse = {
            name: "daily_usage_mv",
            logstore: "execution_log",
            originalSql: "* | select user_id, count(*) as calls group by user_id",
            aggIntervalMins: 5,
            startTime: 1_712_678_400,
            ttl: 30,
            enabled: true,
        };
        const client = new TestClient(response);

        const result = await client.getMaterializedView("project-a", "daily_usage_mv", { retry: 0 });

        expect(result).toBe(response);
        expect(client.request).toEqual({
            method: "GET",
            path: "/materializedviews/daily_usage_mv",
            projectName: "project-a",
            queries: undefined,
            safeKyOptions: { retry: 0 },
        });
    });

    test("deleteMaterializedView 会调用删除接口", async () => {
        const client = new TestClient();

        await client.deleteMaterializedView("project-a", "daily_usage_mv", { timeout: 2000 });

        expect(client.request).toEqual({
            method: "DELETE",
            path: "/materializedviews/daily_usage_mv",
            projectName: "project-a",
            queries: undefined,
            safeKyOptions: { timeout: 2000 },
        });
    });
});

describe("AliCloudSLSLog getLogsV2", () => {
    test("getLogsV2 会调用官方 V2 查询接口", async () => {
        const response: GetLogsV2Response<{ level: string }> = {
            meta: {
                count: 1,
                hasSQL: false,
                progress: "Complete",
            },
            data: [
                {
                    level: "info",
                    __topic__: "app",
                    __source__: "web-1",
                    __time__: "1712678400",
                    __time_ns_part__: "123456789",
                },
            ],
        };
        const client = new TestClient(response);
        const target = client as Partial<AliCloudSLSLog> & {
            getLogsV2?: (
                projectName: string,
                logstoreName: string,
                query: {
                    from: number;
                    to: number;
                    query?: string;
                    line?: number;
                    reverse?: boolean;
                },
                safeKyOptions?: SafeKyOptions,
            ) => Promise<GetLogsV2Response<{ level: string }>>;
        };

        expect(typeof target.getLogsV2).toBe("function");

        const result = await target.getLogsV2!("project-a", "execution_log", {
            from: 1_712_678_400_123,
            to: 1_712_678_460_456,
            query: "* | select level",
            line: 20,
            reverse: true,
        }, { timeout: 6000 });

        expect(result).toBe(response);
        expect(client.request).toEqual({
            method: "POST",
            path: "/logstores/execution_log/logs",
            projectName: "project-a",
            queries: undefined,
            headers: {
                "accept-encoding": "gzip",
            },
            body: JSON.stringify({
                from: 1_712_678_400,
                to: 1_712_678_460,
                query: "* | select level",
                line: 20,
                reverse: true,
            }),
            safeKyOptions: { timeout: 6000 },
        });
    });
});
