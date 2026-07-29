import type { CredentialProvider, Credentials } from "./type";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import ky, { HTTPError } from "ky";

const DEFAULT_STS_ENDPOINT = "sts.aliyuncs.com";
const DEFAULT_REFRESH_BEFORE_EXPIRATION_SECONDS = 300;
const DEFAULT_REFRESH_FAILURE_BACKOFF_SECONDS = 60;
const DEFAULT_REQUEST_TIMEOUT = 30000;
const DEFAULT_ROLE_SESSION_NAME = "alicloud-sls-log";

export interface OIDCCredentialProviderConfig {
    roleArn: string;
    oidcProviderArn: string;
    oidcToken?: string;
    oidcTokenFilePath?: string;
    roleSessionName?: string;
    policy?: string;
    durationSeconds?: number;
    stsEndpoint?: string;
    refreshBeforeExpirationSeconds?: number;
    refreshFailureBackoffSeconds?: number;
    requestTimeout?: number;
}

interface AssumeRoleWithOIDCResponse {
    Credentials?: {
        AccessKeyId?: string;
        AccessKeySecret?: string;
        SecurityToken?: string;
        Expiration?: string;
    };
    Code?: string;
    Message?: string;
    RequestId?: string;
}

interface OIDCCredentials extends Credentials {
    expiration: Date;
}

export class OIDCCredentialProvider {
    private credentials: OIDCCredentials | null = null;
    private refreshBlockedUntil = 0;
    private refreshPromise: Promise<Credentials> | null = null;
    private lastRefreshError: unknown = null;

    public constructor(private readonly config: OIDCCredentialProviderConfig) {
    }

    // A bound arrow property, so the natural `credentialProvider: provider.getCredentials` does not lose `this`
    public getCredentials = async (): Promise<Credentials> => {
        if (this.credentials && !this.shouldRefresh(this.credentials)) {
            return this.credentials;
        }

        // Back off on every failure path: neither a cold start nor expired credentials may forward the caller's QPS straight to STS
        if (this.refreshBlockedUntil > Date.now()) {
            const usable = this.getUsableCredentials();
            if (usable) {
                return usable;
            }

            throw new Error(
                `Refreshing STS credentials is backing off for another ${Math.ceil((this.refreshBlockedUntil - Date.now()) / 1000)}s after a failed refresh`,
                { cause: this.lastRefreshError },
            );
        }

        const refreshPromise = this.refreshPromise ?? (this.refreshPromise = this.refresh());

        try {
            return await refreshPromise;
        }
        catch (error) {
            this.lastRefreshError = error;
            this.refreshBlockedUntil = Date.now() + this.getRefreshFailureBackoffMilliseconds();

            const usable = this.getUsableCredentials();
            if (usable) {
                return usable;
            }

            throw error;
        }
        finally {
            // Only clear the refresh this call started, so a newer in-flight refresh is never dropped
            if (this.refreshPromise === refreshPromise) {
                this.refreshPromise = null;
            }
        }
    };

    private getUsableCredentials(): Credentials | null {
        return this.credentials && !this.isExpired(this.credentials) ? this.credentials : null;
    }

    private async refresh(): Promise<Credentials> {
        const oidcToken = await this.getOIDCToken();
        const body = new URLSearchParams({
            Action: "AssumeRoleWithOIDC",
            Format: "JSON",
            OIDCProviderArn: this.config.oidcProviderArn,
            OIDCToken: oidcToken,
            RoleArn: this.config.roleArn,
            RoleSessionName: this.config.roleSessionName ?? DEFAULT_ROLE_SESSION_NAME,
            SignatureNonce: randomUUID(),
            Timestamp: createSTSTimestamp(),
            Version: "2015-04-01",
        });

        if (this.config.durationSeconds !== undefined) {
            body.set("DurationSeconds", String(this.config.durationSeconds));
        }

        if (this.config.policy) {
            body.set("Policy", this.config.policy);
        }

        // ky only retries idempotent methods by default, and throwHttpErrors:false disables status-code retries entirely,
        // so the methods must be declared explicitly and ky must be allowed to throw HTTPError, otherwise retry is dead config
        let response: Response;
        try {
            response = await ky.post(getSTSEndpointURL(this.config.stsEndpoint), {
                body,
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                retry: {
                    limit: 2,
                    methods: ["post"],
                },
                timeout: this.config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
            });
        }
        catch (error) {
            if (error instanceof HTTPError) {
                const text = await error.response.text().catch(() => "");
                throw new Error(formatSTSError(error.response.status, error.response.statusText, parseSTSResponse(text)));
            }

            throw error;
        }

        const data = parseSTSResponse(await response.text());
        const credentials = data.Credentials;
        if (!credentials?.AccessKeyId || !credentials.AccessKeySecret || !credentials.SecurityToken || !credentials.Expiration) {
            throw new Error("AssumeRoleWithOIDC response did not include complete credentials");
        }

        const expiration = new Date(credentials.Expiration);
        if (Number.isNaN(expiration.getTime())) {
            throw new TypeError("AssumeRoleWithOIDC response included an invalid credentials expiration");
        }

        this.credentials = {
            accessKeyID: credentials.AccessKeyId,
            accessKeySecret: credentials.AccessKeySecret,
            expiration,
            stsToken: credentials.SecurityToken,
        };
        this.refreshBlockedUntil = 0;
        this.lastRefreshError = null;

        return this.credentials;
    }

    private async getOIDCToken(): Promise<string> {
        if (this.config.oidcToken) {
            return this.config.oidcToken;
        }

        if (!this.config.oidcTokenFilePath) {
            throw new Error("Either oidcToken or oidcTokenFilePath is required for OIDC credentials");
        }

        return (await readFile(this.config.oidcTokenFilePath, "utf8")).trim();
    }

    private shouldRefresh(credentials: OIDCCredentials): boolean {
        const refreshBeforeExpirationSeconds = Math.max(
            0,
            this.config.refreshBeforeExpirationSeconds ?? DEFAULT_REFRESH_BEFORE_EXPIRATION_SECONDS,
        );
        return credentials.expiration.getTime() - Date.now() <= refreshBeforeExpirationSeconds * 1000;
    }

    private isExpired(credentials: OIDCCredentials): boolean {
        return credentials.expiration.getTime() <= Date.now();
    }

    private getRefreshFailureBackoffMilliseconds(): number {
        return Math.max(
            0,
            this.config.refreshFailureBackoffSeconds ?? DEFAULT_REFRESH_FAILURE_BACKOFF_SECONDS,
        ) * 1000;
    }
}

export function createOIDCCredentialProvider(config: OIDCCredentialProviderConfig): CredentialProvider {
    const provider = new OIDCCredentialProvider(config);
    return () => provider.getCredentials();
}

export function createOIDCCredentialProviderFromEnv(config: Partial<OIDCCredentialProviderConfig> = {}): CredentialProvider {
    const env = process.env;
    const roleArn = config.roleArn ?? env.ALIBABA_CLOUD_ROLE_ARN;
    const oidcProviderArn = config.oidcProviderArn ?? env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN;
    const oidcTokenFilePath = config.oidcTokenFilePath ?? env.ALIBABA_CLOUD_OIDC_TOKEN_FILE;

    if (!roleArn) {
        throw new Error("roleArn or ALIBABA_CLOUD_ROLE_ARN is required for OIDC credentials");
    }

    if (!oidcProviderArn) {
        throw new Error("oidcProviderArn or ALIBABA_CLOUD_OIDC_PROVIDER_ARN is required for OIDC credentials");
    }

    if (!config.oidcToken && !oidcTokenFilePath) {
        throw new Error("oidcToken, oidcTokenFilePath, or ALIBABA_CLOUD_OIDC_TOKEN_FILE is required for OIDC credentials");
    }

    return createOIDCCredentialProvider({
        ...config,
        oidcProviderArn,
        oidcTokenFilePath,
        roleArn,
        roleSessionName: config.roleSessionName ?? env.ALIBABA_CLOUD_ROLE_SESSION_NAME,
        stsEndpoint: config.stsEndpoint ?? env.ALIBABA_CLOUD_STS_ENDPOINT,
    });
}

function parseSTSResponse(text: string): AssumeRoleWithOIDCResponse {
    try {
        return JSON.parse(text) as AssumeRoleWithOIDCResponse;
    }
    catch {
        return {
            Message: text,
        };
    }
}

function getSTSEndpointURL(endpoint = DEFAULT_STS_ENDPOINT): string {
    const url = new URL(endpoint.startsWith("http://") || endpoint.startsWith("https://")
        ? endpoint
        : `https://${endpoint}`);

    if (!url.pathname.endsWith("/")) {
        url.pathname = `${url.pathname}/`;
    }

    return url.toString();
}

function createSTSTimestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatSTSError(status: number, statusText: string, data: AssumeRoleWithOIDCResponse): string {
    const parts = [`Failed to assume role with OIDC: ${status} ${statusText}`];

    if (data.Code) {
        parts.push(data.Code);
    }

    if (data.Message) {
        parts.push(data.Message);
    }

    if (data.RequestId) {
        parts.push(`RequestId: ${data.RequestId}`);
    }

    return parts.join(": ");
}
