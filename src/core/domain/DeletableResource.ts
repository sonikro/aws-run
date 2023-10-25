export interface DeletableResource {
  tearDown: () => Promise<void>
}
