export interface RemoteEnvironmentTeardown<Settings = any> {
  tearDown: (args: {settings: Settings}) => Promise<void>
}
