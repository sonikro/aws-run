export interface Environment<EnvironmentData> {
    data: EnvironmentData
}

export interface ExecutionResult {
    output: string;
    exitCode: number;
}

export interface RemoteEnvironment<AuthSession = any, Credentials = any, EnvironmentData = any> {
    authenticate: (credentials: Credentials) => Promise<AuthSession>
    setup: (authSession: AuthSession) => Promise<Environment<EnvironmentData>>
    execute: (arg: { environment: Environment<EnvironmentData>, image: string, run: string }) => Promise<ExecutionResult>;
    tearDown: (authSession: AuthSession) => Promise<void>
}