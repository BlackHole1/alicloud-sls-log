export { AliCloudSLSLog } from "./client";

export {
    createOIDCCredentialProvider,
    createOIDCCredentialProviderFromEnv,
    OIDCCredentialProvider,
    type OIDCCredentialProviderConfig,
} from "./credentials";

export { AliCloudSLSLogError, Request } from "./request";

export type {
    AliCloudSLSLogOption,
    CreateMaterializedView,
    CredentialProvider,
    Credentials,
    GetLogsQuery,
    GetLogsResponse,
    GetLogsV2Meta,
    GetLogsV2Query,
    GetLogsV2Response,
    GetMaterializedViewResponse,
    ListMaterializedViewsQuery,
    ListMaterializedViewsResponse,
    LogData,
    LogEntity,
    ProviderRequestConfig,
    RequestConfig,
    SafeKyOptions,
    StaticRequestConfig,
} from "./type";

export { createLog } from "./utils";
