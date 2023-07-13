export interface Environment<EnvironmentData> {
    data: EnvironmentData
}

export interface ExecutionResult {
    output: string;
    exitCode: number;
}

export interface RemoteEnvironment<EnvironmentData = any, SetupSettings = any> {
    setup: (args: { settings: SetupSettings }) => Promise<Environment<EnvironmentData>>
    execute: (args: { environment: Environment<EnvironmentData>, image: string, run: string }) => Promise<ExecutionResult>;
    tearDown: (args: {environment: Environment<EnvironmentData>}) => Promise<void>
}