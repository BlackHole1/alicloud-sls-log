import type { ParsedUrlQueryInput } from "node:querystring";
import type { RequestConfig, SafeKyOptions } from "./type";
import { createHash, createHmac } from "node:crypto";
import querystring from "node:querystring";
import ky from "ky";

const DEFAULT_REQUEST_OPTIONS: SafeKyOptions = {
    timeout: 3000,
    retry: 2,
    throwHttpErrors: false,
};

interface RequestOptions {
    method: "POST" | "GET" | "PUT" | "DELETE";
    path: string;
    queries?: Record<string, any>;
    body?: Uint8Array;
    headers?: Record<string, string>;
    projectName?: string;
    safeKyOptions?: SafeKyOptions;
}

export class AliCloudSLSLogError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly requestid: string | null,
    ) {
        super(message);
        this.name = `${code}Error`;
    }
}

export class Request {
    public constructor(private readonly config: RequestConfig) {
    }

    public updateCredential(accessKeyID: string, accessKeySecret: string, stsToken?: string): void {
        this.config.accessKeyID = accessKeyID;
        this.config.accessKeySecret = accessKeySecret;
        this.config.stsToken = stsToken;
    }

    protected async do(options: RequestOptions): Promise<any> {
        const headers: Record<string, string> = Object.assign({
            "content-type": "application/json",
            "date": new Date().toUTCString(),
            "x-log-apiversion": "0.6.0",
            "x-log-signaturemethod": "hmac-sha1",
        }, options.headers);

        if (this.config.stsToken) {
            headers["x-acs-security-token"] = this.config.stsToken;
        }

        if (options.body) {
            headers["content-length"] = options.body.length.toString();
            headers["content-md5"] = createHash("md5").update(options.body).digest("hex").toUpperCase();
        }
        headers.authorization = this.sign(options.method, formatResource(options.path, options.queries), headers);

        const url = `http://${buildProjectName(options.projectName)}${this.config.endpoint}${options.path}${buildQueries(options.queries)}`;

        const response = await ky(url, {
            method: options.method,
            body: options.body,
            headers,
            ...DEFAULT_REQUEST_OPTIONS,
            ...this.config.globalSafeKyOptions,
            ...options.safeKyOptions,
        });

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.startsWith("application/json")) {
            return response.text();
        }

        const body: Record<string, any> = await response.json();

        if (body.errorCode && body.errorMessage) {
            throw new AliCloudSLSLogError(
                body.errorMessage,
                body.errorCode,
                response.headers.get("x-log-requestid"),
            );
        }

        if (body.Error) {
            throw new AliCloudSLSLogError(
                body.Error.Message,
                body.Error.Code,
                body.Error.RequestId,
            );
        }

        return body;
    }

    private sign(method: string, resource: string, headers: Record<string, string>): string {
        const contentMD5 = headers["content-md5"] || "";
        const contentType = headers["content-type"] || "";
        const date = headers.date;
        const canonicalizedHeaders = getCanonicalizedHeaders(headers);
        const signString = `${method}\n${contentMD5}\n${contentType}\n`
            + `${date}\n${canonicalizedHeaders}\n${resource}`;
        const signature = createHmac("sha1", this.config.accessKeySecret).update(signString).digest("base64");

        return `LOG ${this.config.accessKeyID}:${signature}`;
    }
}

function buildQueries(queries?: ParsedUrlQueryInput): string {
    const str = querystring.stringify(queries);
    return str ? `?${str}` : "";
}

function buildProjectName(projectName?: string): string {
    return projectName ? `${projectName}.` : "";
}

function formatString(value: any): string {
    if (typeof value === "undefined") {
        return "";
    }

    return String(value);
}

function formatResource(path: string, queries?: ParsedUrlQueryInput): string {
    if (!queries) {
        return path;
    }

    const keys = Object.keys(queries);
    if (!keys.length) {
        return path;
    }

    const queryStr = keys
        .sort()
        .map(key => `${key}=${formatString(queries[key])}`)
        .join("&");

    return `${path}?${queryStr}`;
}

function getCanonicalizedHeaders(headers: Record<string, string>): string {
    return Object.keys(headers)
        .filter(key => key.startsWith("x-log-") || key.startsWith("x-acs-"))
        .sort()
        .map(key => `${key}:${headers[key]!.trim()}`)
        .join("\n");
}
