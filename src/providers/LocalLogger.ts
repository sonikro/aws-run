import {Logger} from '../core/provider/Logger'

export class LocalLogger implements Logger {
  info(message: string): void {
    console.log(message)
  }
  debug(message: string): void {
    console.debug(message)
  }
}
