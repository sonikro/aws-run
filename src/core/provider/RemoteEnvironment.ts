export interface ExecutionResult {
  exitCode: number
}

export interface ExecutionSettings {
  image: string
  run: string
  shell: string
}
export interface RemoteEnvironment<Settings = any> {
  /**
   * Given Execution Settings. Execute the remote code, and return
   */
  execute: (args: {settings: Settings}) => Promise<ExecutionResult>

  tearDown: () => Promise<void>
}
