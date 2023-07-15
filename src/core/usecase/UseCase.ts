/**
 * Basic contract of a Use Case
 */
export interface UseCase<Input, Output> {
  run(input: Input): Promise<Output>
}
